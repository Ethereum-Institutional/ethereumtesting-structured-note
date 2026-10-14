// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {LockedSettlement} from "../src/LockedSettlement.sol";
import {Stack, IERC20Like} from "./Stack.sol";

/**
 * Delivery versus payment by locked offer (ADR 0081) on the ERC-3643 note: each proposer's side
 * locked until the offer settles or ends, named or open counterparties, and the instruments' own
 * eligibility deciding. The settlement contract is a note agent that may only freeze part of a
 * holding (ADR 0085).
 */
contract LockedSettlementTest is Stack {
    LockedSettlement s;

    address a = makeAddr("investor A");
    address b = makeAddr("investor B");
    address c = makeAddr("investor C");
    address outsider = makeAddr("onboarded for cash only");
    address stranger = makeAddr("anyone");

    uint256 constant PRICE = 100_000; // €1,000.00 a unit

    function setUp() public {
        _deployStack();
        s = l.settlement;
        _onboard(a, true);
        _onboard(b, true);
        _onboard(c, true);
        _onboard(outsider, false);
        for (uint256 i = 0; i < 4; ++i) {
            address who = [a, b, c, outsider][i];
            _credit(who, 10_000_00 * 100);
            vm.prank(who);
            IERC20Like(address(d.deposit)).approve(address(s), type(uint256).max);
        }
        vm.startPrank(inventory);
        l.note.mint(a, 5);
        l.note.mint(b, 5);
        l.note.unpause();
        vm.stopPrank();
    }

    function _sell(address seller, address to, uint64 units) internal returns (uint256 id) {
        vm.startPrank(seller);
        IERC20Like(address(l.note)).approve(address(s), units);
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
        assertEq(l.note.balanceOf(a), 5, "the units stay the seller's");
        assertEq(l.note.getFrozenTokens(a), 2);
        assertEq(s.lockedUnits(a), 2);
        assertEq(l.note.balanceOf(address(s)), 0, "nothing is parked in the contract");

        vm.prank(a);
        vm.expectRevert();
        IERC20Like(address(l.note)).transfer(c, 4); // only three are unlocked

        uint256 cashA = d.deposit.balanceOf(a);
        vm.prank(b);
        s.accept(id);
        assertEq(l.note.balanceOf(a), 3);
        assertEq(l.note.balanceOf(b), 7);
        assertEq(l.note.getFrozenTokens(a), 0);
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
        IERC20Like(address(l.note)).approve(address(s), 1);
        s.accept(id);
        vm.stopPrank();
        assertEq(l.note.balanceOf(b), 6);
        assertEq(l.note.balanceOf(a), 4);
        assertEq(d.deposit.balanceOf(a), cashA + PRICE);
        assertEq(d.deposit.balanceOf(address(s)), 0);
    }

    function test_cannotLockMoreThanIsUnlocked_orWithoutAnAllowance() public {
        _sell(a, b, 4);
        vm.startPrank(a);
        IERC20Like(address(l.note)).approve(address(s), 2);
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
    /// without the onboarding agent's claim (S-12), and the whole settlement fails with it.
    function test_openOffer_anyEligibleTaker_ineligibleRefused() public {
        uint256 id = _sell(a, address(0), 1);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(LockedSettlement.NoteLegRefused.selector, a, outsider, 1));
        s.accept(id);
        assertEq(l.note.getFrozenTokens(a), 1, "a refused acceptance changes nothing");
        vm.prank(c);
        s.accept(id);
        assertEq(l.note.balanceOf(c), 1);
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
        assertEq(l.note.getFrozenTokens(a), 0);
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
        assertEq(l.note.getFrozenTokens(a), 0);
    }

    /// Opening a redemption pauses the note; frozen units could not be burned, so anyone may then
    /// release every open offer, and the redemption pays.
    function test_anyoneReleases_onceTheNoteIsPaused() public {
        uint256 id = _sell(a, b, 2);
        l.note.addAgent(address(this)); // the test is the note's owner until the ceremony
        l.note.pause();
        vm.prank(stranger);
        s.release(id);
        assertEq(l.note.getFrozenTokens(a), 0);
    }

    /// The note's enforcer unfreezing the account meanwhile does not trap the offer.
    function test_unlock_neverUnfreezesMoreThanIsFrozen() public {
        uint256 id = _sell(a, b, 2);
        l.note.addAgent(address(this));
        l.note.unfreezePartialTokens(a, 2);
        vm.prank(a);
        s.cancel(id);
        assertEq(s.lockedUnits(a), 0);
    }

    // --- restricted agent ---

    /// The settlement contract may freeze part of a holding, and nothing else.
    function test_settlementIsAnAgentForPartialFreezingOnly() public {
        vm.startPrank(address(s));
        vm.expectRevert();
        l.note.mint(address(s), 1);
        vm.expectRevert();
        l.note.burn(a, 1);
        vm.expectRevert();
        l.note.forcedTransfer(a, b, 1);
        vm.expectRevert();
        l.note.setAddressFrozen(a, true);
        vm.expectRevert();
        l.note.pause();
        l.note.freezePartialTokens(a, 1);
        vm.stopPrank();
        assertEq(l.note.getFrozenTokens(a), 1);
    }
}
