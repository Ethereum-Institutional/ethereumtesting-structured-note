// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {DeterminationAgent} from "../src/DeterminationAgent.sol";
import {RecordDateModule} from "../src/compliance/RecordDateModule.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {LockedSettlement} from "../src/LockedSettlement.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IProgrammeRoles} from "../src/interfaces/IProgrammeRoles.sol";
import {Stack, IERC20Like} from "./Stack.sol";

interface IForcedTransfer {
    function forcedTransfer(address from, address to, uint256 amount) external returns (bool);
}

/**
 * The lifecycle's controls on the ERC-3643 note, each shown binding: determinations (D1, S1 to
 * S3, P6), entitlement at the Record Time (E1, E2), the transfer stop (E4), reconciled
 * distribution and held payments.
 */
contract LifecycleTest is Stack {
    address a = makeAddr("investor A");
    address b = makeAddr("investor B");
    address cashOnly = makeAddr("onboarded for cash only");

    function setUp() public {
        _deployStack();
        _onboard(a, true);
        _onboard(b, true);
        _onboard(cashOnly, false);
        _credit(agent, 100_000_000_00);
        _credit(a, 1_000_000_00);
        _credit(b, 1_000_000_00);
        vm.prank(agent);
        IERC20Like(address(d.deposit)).approve(address(l.payingAgent), type(uint256).max);
        _issueUnits(20);
    }

    // --- determinations ---

    /// D1: an outcome that disagrees with the contract's own is refused, and nothing changes.
    function test_disagreeingOutcomeRefused() public {
        vm.warp(_obs(0).date);
        uint256[] memory lv = _levels(9_000);
        (IDeterminationAgent.Outcome memory o,) = l.determinations.compute(0, lv);
        o.couponPerCa += 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CA_KEY, l.determinations.digest(0, lv, o));
        vm.expectPartialRevert(IDeterminationAgent.OutcomeDisagrees.selector);
        l.determinations.determine(0, lv, o, abi.encodePacked(r, s, v));
        assertEq(l.determinations.nextDate(), 0);
    }

    /// D1: only the Calculation Agent's signature is accepted.
    /// S-20: a determination signed for another network is refused: the signature is bound to the
    /// network and to this contract by its EIP-712 domain. (A replay is refused by test_orderAndTiming.)
    function test_determinationSignedForAnotherNetworkRefused() public {
        vm.warp(_obs(0).date);
        uint256[] memory lv = _levels(9_000);
        (IDeterminationAgent.Outcome memory o,) = l.determinations.compute(0, lv);
        uint256 here = block.chainid;
        vm.chainId(here + 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CA_KEY, l.determinations.digest(0, lv, o));
        vm.chainId(here);
        vm.expectRevert(IDeterminationAgent.BadSignature.selector);
        l.determinations.determine(0, lv, o, abi.encodePacked(r, s, v));
        // Signed for this network by the Calculation Agent, the same determination is accepted.
        (v, r, s) = vm.sign(CA_KEY, l.determinations.digest(0, lv, o));
        l.determinations.determine(0, lv, o, abi.encodePacked(r, s, v));
        assertTrue(l.determinations.determined(0));
    }

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
        _refused(t, "barrier above coupon barrier");
        t = _terms();
        t.schedule[3].barrier = false;
        _refused(t, "barrier always observed on the final date");
        t = _terms();
        t.schedule[1].date = t.schedule[0].date;
        _refused(t, "schedule not strictly ordered");
    }

    /// A clone initialised on invalid terms is refused, as the factory would find at issuance.
    function _refused(IDeterminationAgent.Terms memory t, string memory reason) internal {
        DeterminationAgent da = DeterminationAgent(Clones.clone(d.implementations.determinations));
        vm.expectRevert(abi.encodeWithSelector(IDeterminationAgent.InvalidTerms.selector, reason));
        da.initialize(t, IProgrammeRoles(address(p.controller)));
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
        _send(a, b, 4); // counts
        vm.warp(rt + 1);
        _send(a, b, 1); // does not
        assertEq(l.recordDates.balanceAt(a, rt), 6);
        assertEq(l.recordDates.balanceAt(b, rt), 4);
        assertEq(l.recordDates.balanceAt(a, rt + 1), 5);
        assertEq(l.recordDates.totalSupplyAt(rt), 20, "supply checkpointed at the mint");
    }

    /// S-16 and E2: a coupon goes to holders at the Record Time; the inventory is not paid.
    function test_couponFollowsTheRecordTimeNotTheCurrentHolder() public {
        _place(a, 10);
        vm.warp(_obs(0).date);
        _determine(0, 9_000); // coupon, no MER
        vm.warp(_obs(0).recordTime + 1);
        _send(a, b, 10); // after the Record Time
        vm.warp(_obs(0).paymentDate);
        uint256 aBefore = d.deposit.balanceOf(a);
        uint256 inventoryBefore = d.deposit.balanceOf(inventory);
        vm.startPrank(address(servicing));
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
        vm.expectRevert(); // T-REX: compliance not followed
        IERC20Like(address(l.note)).transfer(b, 1);
        _determine(0, 9_000); // no MER
        assertTrue(l.determinations.transfersOpen(), "reopened");
        _send(a, b, 1);
    }

    /// E4 binds an agent too: a forced transfer skips the compliance check, so the module refuses
    /// it after the move, which undoes it.
    function test_forcedTransferStoppedAtARecordTime() public {
        _place(a, 10);
        address forcer = makeAddr("forcing agent");
        _addAgent(forcer); // the Issuer owns the note through the factory until the ceremony
        vm.warp(_obs(0).recordTime + 1);
        vm.prank(forcer);
        vm.expectRevert(RecordDateModule.TransfersClosed.selector);
        IForcedTransfer(address(l.note)).forcedTransfer(a, b, 1);
        _determine(0, 9_000);
        vm.prank(forcer);
        IForcedTransfer(address(l.note)).forcedTransfer(a, b, 1);
        assertEq(l.recordDates.balanceAt(b, block.timestamp), 1, "checkpointed");
    }

    /// After an MER, transfers stay stopped, the note is paused, and the redemption still burns.
    function test_redemptionClosesTheRegister() public {
        _place(a, 7);
        _place(b, 3);
        vm.warp(_obs(0).date);
        _determine(0, 10_500); // MER on the first date
        vm.warp(_obs(0).paymentDate);
        vm.startPrank(address(servicing));
        bytes32 id = l.payingAgent.open(0, PayingAgent.Kind.Redemption);
        assertTrue(l.note.paused(), "views now agree with the stop");
        address[] memory batch = new address[](2);
        batch[0] = a;
        batch[1] = b;
        l.payingAgent.pay(id, batch);
        vm.stopPrank();
        assertEq(l.note.totalSupply(), 0, "every unit burned, the inventory's included");
        assertEq(l.payingAgent.pending(), 0);
        vm.prank(a);
        vm.expectRevert();
        IERC20Like(address(l.note)).transfer(b, 1);
    }

    // --- reconciliation ---

    /// An event closes only when every unit entitled has been paid, once.
    function test_eventClosesOnlyWhenReconciled() public {
        _place(a, 7);
        _place(b, 3);
        vm.warp(_obs(0).date);
        _determine(0, 9_000);
        vm.warp(_obs(0).paymentDate);
        vm.startPrank(address(servicing));
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

    /// A holder the deposit cannot credit, its bank claim revoked, is held for, and the event
    /// still closes. Vouched for again, it claims.
    function test_unpayableHolderIsHeldAndClaimsLater() public {
        _place(a, 7);
        _place(b, 3);
        vm.warp(_obs(0).date);
        _determine(0, 9_000);
        _revokeCash(b);
        vm.warp(_obs(0).paymentDate);
        vm.startPrank(address(servicing));
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
        _vouchCash(b);
        uint256 before = d.deposit.balanceOf(b);
        l.payingAgent.claim(id, b);
        assertEq(d.deposit.balanceOf(b) - before, 3 * 2_500);
        assertEq(l.payingAgent.held(id, b), 0);
    }

    /// A buy-back returns notional to the inventory; placement takes it out.
    function test_placementAndBuyBackMoveInventory() public {
        _place(a, 10);
        assertEq(l.payingAgent.pending(), 10);
        assertEq(l.payingAgent.live(), 10);
        _credit(inventory, 1_000_000_00);
        vm.prank(inventory);
        IERC20Like(address(d.deposit)).approve(address(l.settlement), type(uint256).max);
        vm.prank(a);
        IERC20Like(address(l.note)).approve(address(l.settlement), 4);
        vm.prank(inventory);
        uint256 id = l.settlement.offer(LockedSettlement.Side.Buy, a, 4, 390_000, uint48(block.timestamp + 1 days));
        vm.prank(a);
        l.settlement.accept(id);
        assertEq(l.payingAgent.pending(), 14, "buy-back returns notional to pending");
        assertEq(l.payingAgent.live(), 6);
    }

    // --- the module ---

    /// The record-date module answers only the note's compliance, and binds no other.
    function test_moduleIsBoundToItsNote() public {
        vm.expectRevert(abi.encodeWithSelector(RecordDateModule.NotTheCompliance.selector, address(this)));
        l.recordDates.moduleTransferAction(a, b, 1);
        assertEq(l.recordDates.note(), address(l.note));
        assertFalse(l.recordDates.canComplianceBind(address(this)));
        vm.expectRevert(abi.encodeWithSelector(RecordDateModule.AlreadyBound.selector, l.compliance));
        l.recordDates.bindCompliance(address(this));
    }

    /// The note is not a place to park units: the settlement contract has no identity.
    function test_settlementContractCannotBeSentUnits() public {
        vm.prank(inventory);
        vm.expectRevert();
        IERC20Like(address(l.note)).transfer(address(l.settlement), 1);
    }

    /// A client onboarded for cash only holds the deposit but cannot receive the note.
    function test_noteNeedsTheNoteClaim() public {
        assertTrue(d.deposit.canReceive(cashOnly));
        assertFalse(l.identityRegistry.isVerified(cashOnly));
        vm.prank(inventory);
        vm.expectRevert();
        IERC20Like(address(l.note)).transfer(cashOnly, 1);
    }
}
