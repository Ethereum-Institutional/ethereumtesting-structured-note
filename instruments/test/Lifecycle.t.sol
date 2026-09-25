// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {DeterminationAgent} from "../src/DeterminationAgent.sol";
import {RecordDateEngine} from "../src/RecordDateEngine.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {DvPSettlement} from "../src/DvPSettlement.sol";
import {Instruments} from "../script/Instruments.sol";
import {Lifecycle} from "../script/Lifecycle.sol";

/**
 * The lifecycle's controls, each shown binding: determinations (D1, S1 to S3, P6), entitlement
 * at the Record Time (E1, E2), the transfer stop (E4), reconciled distribution, held payments,
 * and delivery versus payment.
 */
contract LifecycleTest is Test {
    Instruments.Deployed d;
    Lifecycle.Issued l;

    uint256 caKey = 0xCA11;
    address agent = makeAddr("Agent");
    address accessIssuer = makeAddr("Access Issuer");
    address depositAgent = makeAddr("Deposit Agent");
    address inventory = makeAddr("Issuer inventory");
    address a = makeAddr("investor A");
    address b = makeAddr("investor B");
    address outsider = makeAddr("no Regulation S flag");

    uint256 constant T0 = 1_790_000_000;
    uint256 constant Q = 90 days;
    uint256[] initial;
    uint32 flags;

    function setUp() public {
        vm.warp(T0);
        d = Instruments.deploy(
            Instruments.Config(address(this), agent, accessIssuer, depositAgent, 3 * 365 days, 0, "", "N", "N", "D", "D")
        );
        initial = [uint256(451_200), 1_820_300, 25_000];
        l = Lifecycle.issue(d, _terms(), Lifecycle.Config(address(this), vm.addr(caKey), agent, inventory, agent));

        flags = d.registry.HOLD() | d.registry.RECEIVE() | d.registry.TRANSFER() | d.registry.SANCTIONS_CLEAR();
        _grant(a, flags | d.registry.REG_S());
        _grant(b, flags | d.registry.REG_S());
        _grant(inventory, flags | d.registry.REG_S());
        _grant(agent, flags | d.registry.REG_S());
        _grant(outsider, flags);
        _grant(address(l.payingAgent), flags | d.registry.CONTRACT_ACCOUNT());
        // The debt standard refuses an allowance to a spender that cannot send; the settlement
        // contract carries the settlement right, and no right to hold (ADR 0013).
        _grant(address(l.settlement), d.registry.SETTLEMENT() | d.registry.SANCTIONS_CLEAR() | d.registry.CONTRACT_ACCOUNT());

        vm.prank(depositAgent);
        d.gateway.credit(agent, 100_000_000_00, "funding");
        vm.prank(depositAgent);
        d.gateway.credit(a, 1_000_000_00, "a");
        vm.prank(depositAgent);
        d.gateway.credit(b, 1_000_000_00, "b");
        vm.startPrank(agent);
        d.deposit.approve(address(l.payingAgent), type(uint256).max);
        d.note.mint(inventory, 20);
        vm.stopPrank();
    }

    // --- helpers ---

    /// Quarterly: three coupon and MER dates at a 100% trigger, then the final date.
    function _terms() internal view returns (IDeterminationAgent.Terms memory t) {
        t.initialLevels = initial;
        t.calculationAmountCents = 100_000;
        t.couponBarrierBps = 7_000;
        t.couponRateBps = 250;
        t.barrierBps = 6_000;
        t.schedule = new IDeterminationAgent.Observation[](4);
        for (uint256 k = 0; k < 4; ++k) {
            uint48 date = uint48(T0 + (k + 1) * Q);
            t.schedule[k] = IDeterminationAgent.Observation(
                date, date + 2 days, date + 5 days, true, k < 3, k == 3, k == 3, k < 3 ? 10_000 : 0
            );
        }
    }

    function _grant(address x, uint32 f) internal {
        vm.prank(accessIssuer);
        d.registry.grant(x, f, 276, uint40(T0 + 2 * 365 days), 0, 0);
    }

    /// All three underlyings at `bps` of their Initial Levels.
    function _levels(uint256 bps) internal view returns (uint256[] memory lv) {
        lv = new uint256[](3);
        for (uint256 k = 0; k < 3; ++k) lv[k] = initial[k] * bps / 10_000;
    }

    function _determine(uint256 k, uint256 bps) internal returns (IDeterminationAgent.Outcome memory o) {
        uint256[] memory lv = _levels(bps);
        (o,) = l.determinations.compute(k, lv);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(caKey, l.determinations.digest(k, lv, o));
        l.determinations.determine(k, lv, o, abi.encodePacked(r, s, v));
    }

    function _place(address to, uint64 units) internal {
        vm.prank(inventory);
        d.note.approve(address(l.settlement), units);
        vm.prank(to);
        d.deposit.approve(address(l.settlement), type(uint256).max);
        vm.prank(inventory);
        uint256 id = l.settlement.propose(inventory, to, units, uint256(units) * 100_000, uint48(block.timestamp + 1 days));
        vm.prank(to);
        l.settlement.accept(id);
    }

    function _obs(uint256 k) internal view returns (IDeterminationAgent.Observation memory) {
        return l.determinations.observation(k);
    }

    // --- determinations ---

    /// D1: an outcome that disagrees with the contract's own is refused, and nothing changes.
    function test_disagreeingOutcomeRefused() public {
        vm.warp(_obs(0).date);
        uint256[] memory lv = _levels(9_000);
        (IDeterminationAgent.Outcome memory o,) = l.determinations.compute(0, lv);
        o.couponPerCa += 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(caKey, l.determinations.digest(0, lv, o));
        vm.expectPartialRevert(IDeterminationAgent.OutcomeDisagrees.selector);
        l.determinations.determine(0, lv, o, abi.encodePacked(r, s, v));
        assertEq(l.determinations.nextDate(), 0);
    }

    /// D1: only the Calculation Agent's signature is accepted.
    function test_otherSignerRefused() public {
        vm.warp(_obs(0).date);
        uint256[] memory lv = _levels(9_000);
        (IDeterminationAgent.Outcome memory o,) = l.determinations.compute(0, lv);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, l.determinations.digest(0, lv, o));
        vm.expectRevert(IDeterminationAgent.BadSignature.selector);
        l.determinations.determine(0, lv, o, abi.encodePacked(r, s, v));
    }

    /// S1: in calendar order, one per date, never before the date (D3: any time after).
    function test_orderAndTiming() public {
        vm.warp(_obs(0).date - 1);
        vm.expectRevert(abi.encodeWithSelector(IDeterminationAgent.BeforeScheduledDate.selector, 0, _obs(0).date));
        this.determineExternal(0, 9_000);
        vm.warp(_obs(1).date);
        vm.expectRevert(abi.encodeWithSelector(IDeterminationAgent.NotNextDate.selector, 1, 0));
        this.determineExternal(1, 9_000);
        _determine(0, 9_000);
        vm.expectRevert(abi.encodeWithSelector(IDeterminationAgent.NotNextDate.selector, 0, 1));
        this.determineExternal(0, 9_000);
    }

    function determineExternal(uint256 k, uint256 bps) external {
        _determine(k, bps);
    }

    /// S3: nothing is accepted after the first MER.
    function test_noDeterminationAfterTermination() public {
        vm.warp(_obs(0).date);
        assertTrue(_determine(0, 10_000).redeemed, "MER at the trigger");
        vm.warp(_obs(1).date);
        vm.expectRevert(IDeterminationAgent.Terminated.selector);
        this.determineExternal(1, 9_000);
    }

    /// P6: invalid terms are rejected at issuance, not repaired.
    function test_invalidTermsRejected() public {
        IDeterminationAgent.Terms memory t = _terms();
        t.barrierBps = 7_500; // above the coupon barrier
        vm.expectRevert(abi.encodeWithSelector(IDeterminationAgent.InvalidTerms.selector, "barrier above coupon barrier"));
        new DeterminationAgent(t, vm.addr(caKey));
        t = _terms();
        t.schedule[3].barrier = false;
        vm.expectRevert(
            abi.encodeWithSelector(IDeterminationAgent.InvalidTerms.selector, "barrier always observed on the final date")
        );
        new DeterminationAgent(t, vm.addr(caKey));
        t = _terms();
        t.schedule[1].date = t.schedule[0].date;
        vm.expectRevert(abi.encodeWithSelector(IDeterminationAgent.InvalidTerms.selector, "schedule not strictly ordered"));
        new DeterminationAgent(t, vm.addr(caKey));
    }

    // --- entitlement ---

    /// E1: a transfer in a block stamped exactly at the Record Time counts; one after does not.
    /// The date is determined first (no MER), so transfers are open either side of it.
    function test_recordTimeIsInclusive() public {
        _place(a, 10);
        vm.warp(_obs(0).date);
        _determine(0, 9_000);
        uint256 rt = _obs(0).recordTime;
        vm.warp(rt);
        vm.prank(a);
        d.note.transfer(b, 4); // counts
        vm.warp(rt + 1);
        vm.prank(a);
        d.note.transfer(b, 1); // does not
        assertEq(l.recordDates.balanceAt(a, rt), 6);
        assertEq(l.recordDates.balanceAt(b, rt), 4);
        assertEq(l.recordDates.balanceAt(a, rt + 1), 5);
    }

    /// S-16 and E2: a coupon goes to holders at the Record Time; the inventory is not paid.
    function test_couponFollowsTheRecordTimeNotTheCurrentHolder() public {
        _place(a, 10);
        vm.warp(_obs(0).date);
        _determine(0, 9_000); // coupon, no MER
        vm.warp(_obs(0).recordTime + 1);
        vm.prank(a);
        d.note.transfer(b, 10); // after the Record Time
        vm.warp(_obs(0).paymentDate);
        uint256 aBefore = d.deposit.balanceOf(a);
        uint256 inventoryBefore = d.deposit.balanceOf(inventory);
        vm.startPrank(agent);
        bytes32 id = l.payingAgent.open(0, PayingAgent.Kind.Coupon);
        address[] memory batch = new address[](1);
        batch[0] = b;
        vm.expectRevert(abi.encodeWithSelector(PayingAgent.NotAHolderOfRecord.selector, b));
        l.payingAgent.pay(id, batch);
        batch[0] = a;
        l.payingAgent.pay(id, batch);
        vm.stopPrank();
        assertEq(d.deposit.balanceOf(a) - aBefore, 10 * 2_500, "the seller at the Record Time is paid");
        assertEq(d.deposit.balanceOf(inventory), inventoryBefore, "the inventory is not paid");
        (,, uint64 entitled,,,,,,,) = l.payingAgent.distributions(id);
        assertEq(entitled, 10, "entitled units exclude the inventory's ten");
    }

    // --- the transfer stop (E4) ---

    /// Transfers stop at a date's Record Time until its determination shows no redemption.
    function test_transfersStopAtAPossibleRedemptionUntilDetermined() public {
        _place(a, 10);
        vm.warp(_obs(0).recordTime + 1);
        assertFalse(l.determinations.transfersOpen());
        vm.prank(a);
        vm.expectRevert(RecordDateEngine.TransfersClosed.selector);
        d.note.transfer(b, 1);
        _determine(0, 9_000); // no MER
        assertTrue(l.determinations.transfersOpen(), "reopened");
        vm.prank(a);
        d.note.transfer(b, 1);
    }

    /// After an MER, transfers stay stopped, the note is paused, and the redemption still burns.
    function test_redemptionClosesTheRegister() public {
        _place(a, 7);
        _place(b, 3);
        vm.warp(_obs(1).date);
        vm.warp(_obs(0).date);
        _determine(0, 10_500); // MER on the first date
        vm.warp(_obs(0).paymentDate);
        vm.startPrank(agent);
        bytes32 id = l.payingAgent.open(0, PayingAgent.Kind.Redemption);
        assertTrue(d.note.paused(), "views now agree with the stop");
        address[] memory batch = new address[](2);
        batch[0] = a;
        batch[1] = b;
        l.payingAgent.pay(id, batch);
        vm.stopPrank();
        assertEq(d.note.totalSupply(), 0, "every unit burned, the inventory's included");
        assertEq(l.payingAgent.pending(), 0);
        vm.prank(depositAgent);
        vm.expectRevert();
        d.note.transfer(a, 1);
    }

    // --- reconciliation ---

    /// An event closes only when every unit entitled has been paid, once.
    function test_eventClosesOnlyWhenReconciled() public {
        _place(a, 7);
        _place(b, 3);
        vm.warp(_obs(0).date);
        _determine(0, 9_000);
        vm.warp(_obs(0).paymentDate);
        vm.startPrank(agent);
        bytes32 id = l.payingAgent.open(0, PayingAgent.Kind.Coupon);
        address[] memory one = new address[](1);
        one[0] = a;
        l.payingAgent.pay(id, one);
        (,,,,, bool closed,,,,) = l.payingAgent.distributions(id);
        assertFalse(closed, "a holder is still unpaid");
        vm.expectRevert(abi.encodeWithSelector(PayingAgent.AlreadySettled.selector, a));
        l.payingAgent.pay(id, one);
        one[0] = inventory;
        vm.expectRevert(PayingAgent.InventoryIsNotPaid.selector);
        l.payingAgent.pay(id, one);
        one[0] = b;
        l.payingAgent.pay(id, one);
        vm.stopPrank();
        (,,,,, closed,,,,) = l.payingAgent.distributions(id);
        assertTrue(closed);
        assertEq(d.deposit.balanceOf(address(l.payingAgent)), 0, "funded exactly");
    }

    /// A holder the deposit cannot credit is held for, and the event still closes.
    function test_unpayableHolderIsHeldAndClaimsLater() public {
        _place(a, 7);
        _place(b, 3);
        vm.warp(_obs(0).date);
        _determine(0, 9_000);
        vm.prank(accessIssuer);
        d.registry.revoke(b);
        vm.warp(_obs(0).paymentDate);
        vm.startPrank(agent);
        bytes32 id = l.payingAgent.open(0, PayingAgent.Kind.Coupon);
        address[] memory both = new address[](2);
        both[0] = a;
        both[1] = b;
        l.payingAgent.pay(id, both);
        vm.stopPrank();
        (,,,,, bool closed,,,,) = l.payingAgent.distributions(id);
        assertTrue(closed, "closes for everyone else");
        assertEq(l.payingAgent.held(id, b), 3 * 2_500);

        vm.expectRevert(abi.encodeWithSelector(PayingAgent.CannotReceive.selector, b));
        l.payingAgent.claim(id, b);
        _grant(b, flags | d.registry.REG_S());
        uint256 before = d.deposit.balanceOf(b);
        l.payingAgent.claim(id, b);
        assertEq(d.deposit.balanceOf(b) - before, 3 * 2_500);
        assertEq(l.payingAgent.held(id, b), 0);
    }

    // --- delivery versus payment ---

    function test_placementAndBuyBackMoveInventory() public {
        _place(a, 10);
        assertEq(l.payingAgent.pending(), 10);
        assertEq(l.payingAgent.live(), 10);
        vm.prank(a);
        d.note.approve(address(l.settlement), 4);
        vm.prank(inventory);
        d.deposit.approve(address(l.settlement), type(uint256).max);
        vm.prank(depositAgent);
        d.gateway.credit(inventory, 1_000_000_00, "issuer cash");
        vm.prank(inventory);
        uint256 id = l.settlement.propose(a, inventory, 4, 390_000, uint48(block.timestamp + 1 days));
        vm.prank(a);
        l.settlement.accept(id);
        assertEq(l.payingAgent.pending(), 14, "buy-back returns notional to pending");
        assertEq(l.payingAgent.live(), 6);
    }

    /// Both legs are tested before either moves; a refused leg is named and nothing moves.
    function test_bothLegsOrNeither() public {
        _place(a, 10);
        vm.prank(a);
        d.note.approve(address(l.settlement), 10);
        vm.prank(depositAgent);
        d.gateway.credit(outsider, 1_000_000_00, "outsider");
        vm.prank(outsider);
        d.deposit.approve(address(l.settlement), type(uint256).max);
        vm.prank(a);
        uint256 id = l.settlement.propose(a, outsider, 5, 500_000, uint48(block.timestamp + 1 days));
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(DvPSettlement.NoteLegRefused.selector, a, outsider, 5));
        l.settlement.accept(id);
        assertEq(d.note.balanceOf(a), 10);
        assertEq(d.deposit.balanceOf(outsider), 1_000_000_00);
    }

    function test_onlyTheCounterpartyAccepts() public {
        vm.prank(inventory);
        uint256 id = l.settlement.propose(inventory, a, 1, 100_000, uint48(block.timestamp + 1 days));
        vm.prank(inventory);
        vm.expectRevert(DvPSettlement.ProposerCannotAccept.selector);
        l.settlement.accept(id);
        vm.prank(b);
        vm.expectRevert(abi.encodeWithSelector(DvPSettlement.NotAParty.selector, b));
        l.settlement.accept(id);
        vm.prank(b);
        vm.expectRevert(abi.encodeWithSelector(DvPSettlement.NotAParty.selector, b));
        l.settlement.propose(inventory, a, 1, 1, uint48(block.timestamp + 1));
    }

    function test_expiredOrCancelledTradeCannotSettle() public {
        vm.prank(inventory);
        uint256 id = l.settlement.propose(inventory, a, 1, 100_000, uint48(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(DvPSettlement.Expired.selector, id));
        l.settlement.accept(id);
        vm.prank(a);
        l.settlement.cancel(id);
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(DvPSettlement.NotProposed.selector, id));
        l.settlement.accept(id);
    }

    /// The debt standard refuses an allowance to a spender the gate would not let send.
    function test_allowanceNeedsAnOnboardedSpender() public {
        vm.prank(a);
        vm.expectRevert();
        d.note.approve(makeAddr("unknown operator"), 1);
    }

    /// ADR 0013: units cannot be parked in the settlement contract.
    function test_settlementContractCannotBeSentUnits() public {
        vm.prank(inventory);
        vm.expectRevert();
        d.note.transfer(address(l.settlement), 1);
    }

    /// The record-date engine answers only its own note.
    function test_engineIsBoundToItsNote() public {
        vm.expectRevert(abi.encodeWithSelector(RecordDateEngine.NotTheNote.selector, address(this)));
        l.recordDates.operateOnTransfer(a, b, 0, 0, 0);
    }
}
