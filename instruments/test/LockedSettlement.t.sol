// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {LockedSettlement, INoteLeg, ICashLeg} from "../src/LockedSettlement.sol";
import {Instruments} from "../script/Instruments.sol";
import {Lifecycle} from "../script/Lifecycle.sol";

/**
 * Delivery versus payment by locked offer (ADR 0081): each proposer's side locked until the offer
 * settles or ends, named or open counterparties, and the instruments' own eligibility deciding.
 */
contract LockedSettlementTest is Test {
    Instruments.Deployed d;
    Lifecycle.Issued l;
    LockedSettlement s;

    address agent = makeAddr("Agent");
    address accessIssuer = makeAddr("Access Issuer");
    address depositAgent = makeAddr("Deposit Agent");
    address inventory = makeAddr("Issuer inventory");
    address a = makeAddr("investor A");
    address b = makeAddr("investor B");
    address c = makeAddr("investor C");
    address outsider = makeAddr("no Regulation S flag");
    address stranger = makeAddr("anyone");

    uint256 constant T0 = 1_790_000_000;
    uint256 constant PRICE = 100_000; // €1,000.00 a unit

    function setUp() public {
        vm.warp(T0);
        d = Instruments.deploy(
            Instruments.Config(address(this), agent, accessIssuer, depositAgent, 3 * 365 days, 0, "", "N", "N", "D", "D")
        );
        l = Lifecycle.issue(d, _terms(), Lifecycle.Config(address(this), makeAddr("CA"), agent, inventory, agent));
        s = new LockedSettlement(INoteLeg(address(d.note)), ICashLeg(address(d.deposit)));
        // The settlement freezes and unfreezes the units of its open offers.
        d.note.grantRole(keccak256("ERC20ENFORCER_ROLE"), address(s));

        uint32 flags = d.registry.HOLD() | d.registry.RECEIVE() | d.registry.TRANSFER() | d.registry.SANCTIONS_CLEAR();
        for (uint256 i = 0; i < 4; ++i) _grant([a, b, c, inventory][i], flags | d.registry.REG_S());
        _grant(outsider, flags);
        // Settlement right for its allowances, and the right to hold the deposit; never the
        // Regulation S flag the note requires, so it can never hold the note.
        _grant(address(s), flags | d.registry.SETTLEMENT() | d.registry.CONTRACT_ACCOUNT());

        for (uint256 i = 0; i < 4; ++i) {
            address who = [a, b, c, outsider][i];
            vm.prank(depositAgent);
            d.gateway.credit(who, 10_000_00 * 100, bytes32(i + 1));
            vm.prank(who);
            d.deposit.approve(address(s), type(uint256).max);
        }
        vm.prank(agent);
        d.note.mint(a, 5);
        vm.prank(agent);
        d.note.mint(b, 5);
    }

    function _terms() internal view returns (IDeterminationAgent.Terms memory t) {
        t.initialLevels = new uint256[](1);
        t.initialLevels[0] = 100;
        t.calculationAmountCents = 100_000;
        t.couponBarrierBps = 7_000;
        t.couponRateBps = 250;
        t.barrierBps = 6_000;
        t.schedule = new IDeterminationAgent.Observation[](1);
        uint48 date = uint48(block.timestamp + 90 days);
        t.schedule[0] = IDeterminationAgent.Observation(date, date + 2 days, date + 5 days, true, false, true, true, 0);
    }

    function _grant(address x, uint32 f) internal {
        vm.prank(accessIssuer);
        d.registry.grant(x, f, 276, uint40(T0 + 2 * 365 days), 0, 0);
    }

    function _sell(address seller, address to, uint64 units) internal returns (uint256 id) {
        vm.startPrank(seller);
        d.note.approve(address(s), units);
        id = s.offer(LockedSettlement.Side.Sell, to, units, units * PRICE, uint48(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function _buy(address buyer, address from, uint64 units) internal returns (uint256 id) {
        vm.prank(buyer);
        id = s.offer(LockedSettlement.Side.Buy, from, units, units * PRICE, uint48(block.timestamp + 1 days));
    }

    // --- locking ---

    /// An offer to sell freezes the units in the seller's wallet: still its, and unspendable.
    function test_sellOffer_locksUnitsInPlace_thenSettlesBothLegs() public {
        uint256 id = _sell(a, b, 2);
        assertEq(d.note.balanceOf(a), 5, "the units stay the seller's");
        assertEq(d.note.getFrozenTokens(a), 2);
        assertEq(s.lockedUnits(a), 2);
        assertEq(d.note.balanceOf(address(s)), 0, "nothing is parked in the contract");

        vm.prank(a);
        vm.expectRevert();
        d.note.transfer(c, 4); // only three are unlocked

        uint256 cashA = d.deposit.balanceOf(a);
        vm.prank(b);
        s.accept(id);
        assertEq(d.note.balanceOf(a), 3);
        assertEq(d.note.balanceOf(b), 7);
        assertEq(d.note.getFrozenTokens(a), 0);
        assertEq(d.deposit.balanceOf(a), cashA + 2 * PRICE);
    }

    /// An offer to buy holds the price here until it settles; the contract never holds the note.
    function test_buyOffer_holdsThePrice_thenSettlesBothLegs() public {
        uint256 cashB = d.deposit.balanceOf(b);
        uint256 id = _buy(b, address(0), 1);
        assertEq(d.deposit.balanceOf(address(s)), PRICE);
        assertEq(d.deposit.balanceOf(b), cashB - PRICE);

        uint256 cashA = d.deposit.balanceOf(a);
        vm.startPrank(a);
        d.note.approve(address(s), 1);
        s.accept(id);
        vm.stopPrank();
        assertEq(d.note.balanceOf(b), 6);
        assertEq(d.note.balanceOf(a), 4);
        assertEq(d.deposit.balanceOf(a), cashA + PRICE);
        assertEq(d.deposit.balanceOf(address(s)), 0);
    }

    function test_cannotLockMoreThanIsUnlocked_orWithoutAnAllowance() public {
        _sell(a, b, 4);
        vm.startPrank(a);
        d.note.approve(address(s), 2);
        vm.expectRevert(abi.encodeWithSelector(LockedSettlement.UnitsUnavailable.selector, a, 2, 1));
        s.offer(LockedSettlement.Side.Sell, b, 2, 2 * PRICE, uint48(block.timestamp + 1 days));
        vm.stopPrank();

        vm.prank(b);
        vm.expectRevert(abi.encodeWithSelector(LockedSettlement.NoAllowance.selector, b, 1));
        s.offer(LockedSettlement.Side.Sell, a, 1, PRICE, uint48(block.timestamp + 1 days));
    }

    /// Frozen units are still the seller's at a Record Time: it remains the holder of record.
    function test_lockedUnits_stayWithTheHolderOfRecord() public {
        _sell(a, address(0), 3);
        vm.warp(block.timestamp + 1 hours);
        assertEq(l.recordDates.balanceAt(a, block.timestamp - 1), 5);
    }

    // --- named and open ---

    function test_namedOffer_onlyItsCounterpartyAccepts() public {
        uint256 id = _sell(a, b, 1);
        vm.prank(c);
        vm.expectRevert(abi.encodeWithSelector(LockedSettlement.NotTheCounterparty.selector, c));
        s.accept(id);
        vm.prank(a);
        vm.expectRevert(LockedSettlement.ProposerCannotAccept.selector);
        s.accept(id);
    }

    /// An open offer is taken by the first account both instruments accept; the note refuses one
    /// without the Regulation S flag (S-12), and the whole settlement fails with it.
    function test_openOffer_anyEligibleTaker_ineligibleRefused() public {
        uint256 id = _sell(a, address(0), 1);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(LockedSettlement.NoteLegRefused.selector, a, outsider, 1));
        s.accept(id);
        assertEq(d.note.getFrozenTokens(a), 1, "a refused acceptance changes nothing");
        vm.prank(c);
        s.accept(id);
        assertEq(d.note.balanceOf(c), 1);
    }

    // --- ending ---

    function test_cancelAndDecline_returnTheLock_strangersCannot() public {
        uint256 sell = _sell(a, b, 2);
        uint256 buy = _buy(b, a, 1);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(LockedSettlement.NotAParty.selector, stranger));
        s.cancel(sell);

        vm.prank(a);
        s.cancel(sell);
        assertEq(d.note.getFrozenTokens(a), 0);
        uint256 cashB = d.deposit.balanceOf(b);
        vm.prank(a); // the named counterparty declines
        s.cancel(buy);
        assertEq(d.deposit.balanceOf(b), cashB + PRICE);
        vm.prank(b);
        vm.expectRevert(abi.encodeWithSelector(LockedSettlement.NotOpen.selector, buy));
        s.accept(buy);
    }

    function test_anyoneReleases_pastTheDeadline() public {
        uint256 id = _sell(a, b, 2);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(LockedSettlement.StillLive.selector, id));
        s.release(id);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(b);
        vm.expectRevert(abi.encodeWithSelector(LockedSettlement.Expired.selector, id));
        s.accept(id);
        vm.prank(stranger);
        s.release(id);
        assertEq(d.note.getFrozenTokens(a), 0);
    }

    /// Opening a redemption pauses the note; frozen units could not be burned, so anyone may then
    /// release every open offer, and the redemption pays.
    function test_anyoneReleases_onceTheNoteIsPaused() public {
        uint256 id = _sell(a, b, 2);
        d.note.grantRole(d.note.PAUSER_ROLE(), address(this));
        d.note.pause();
        vm.prank(stranger);
        s.release(id);
        assertEq(d.note.getFrozenTokens(a), 0);
    }

    /// The note's enforcer unfreezing the account meanwhile does not trap the offer.
    function test_unlock_neverUnfreezesMoreThanIsFrozen() public {
        uint256 id = _sell(a, b, 2);
        d.note.grantRole(keccak256("ERC20ENFORCER_ROLE"), address(this));
        d.note.unfreezePartialTokens(a, 2);
        vm.prank(a);
        s.cancel(id);
        assertEq(s.lockedUnits(a), 0);
    }
}
