// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {LockedSettlement} from "../src/LockedSettlement.sol";
import {Stack, IERC20Like} from "./Stack.sol";

/**
 * The order of lifecycle events (docs/lifecycle-sequence.md), walked in that order on one
 * note. Each step is taken when the sequence allows it, after it has been tried too early or out of
 * turn and refused; the step numbers are the document's.
 *
 * The note has four quarterly dates. Date 1 pays a coupon and does not redeem; date 2 redeems early
 * (MER), so dates 3 and 4 fall away.
 */
contract SequenceTest is Stack {
    address a = makeAddr("investor A");
    address b = makeAddr("investor B");
    address late = makeAddr("onboarded late");

    function setUp() public {
        _deployStack(); // §2.1: the note issued through the factory, paused, with nothing minted yet
        _credit(agent, 100_000_000_00); // §2.3: the bank funds the Agent
        vm.prank(agent);
        IERC20Like(address(d.deposit)).approve(address(l.payingAgent), type(uint256).max); // §2.4
    }

    function _offerTo(address buyer, uint64 units, uint48 deadline) internal returns (uint256 id) {
        vm.prank(inventory);
        IERC20Like(address(l.note)).approve(address(l.settlement), units);
        vm.prank(inventory);
        id = l.settlement.offer(LockedSettlement.Side.Sell, buyer, units, uint256(units) * 100_000, deadline);
        vm.prank(buyer);
        IERC20Like(address(d.deposit)).approve(address(l.settlement), uint256(units) * 100_000);
    }

    function _pay(bytes32 id, address holder) internal {
        address[] memory batch = new address[](1);
        batch[0] = holder;
        vm.prank(address(servicing));
        l.payingAgent.pay(id, batch);
    }

    uint256 untaken;

    function test_theSequenceInOrder() public {
        _onboardingAndIssuance(); // §1, §2
        _placementAndTrading(); // §3
        _date1(); // §4
        _date2Redeems(); // §5.1
        _redemption(); // §5.2 to §5.5
    }

    function _onboardingAndIssuance() internal {
        // §1. Onboarding comes first: a wallet the note's registry does not verify cannot take units.
        assertFalse(l.identityRegistry.isVerified(a));
        _onboard(a, true); // §1.1 to §1.4: identity, consent, the bank's claim, the onboarding agent's
        _onboard(b, true);
        _credit(a, 1_000_000_00);
        _credit(b, 1_000_000_00);

        // §2.1. The note is issued paused: nothing moves until the notional is minted and it opens.
        assertTrue(l.note.paused(), "issued paused");
        vm.prank(address(p.controller));
        l.note.mint(inventory, 20);
        vm.prank(inventory);
        vm.expectRevert();
        IERC20Like(address(l.note)).transfer(a, 1);
        vm.prank(address(p.controller));
        l.note.unpause();
    }

    function _placementAndTrading() internal {
        // §3.1, §3.2. Placement by locked offer: refused to a wallet not onboarded for the note, and after its deadline.
        _onboard(late, false); // the deposit only
        _credit(late, 1_000_000_00);
        uint256 refused = _offerTo(late, 1, uint48(block.timestamp + 1 days));
        vm.prank(late);
        vm.expectRevert(abi.encodeWithSelector(LockedSettlement.NoteLegRefused.selector, inventory, late, 1));
        l.settlement.accept(refused);
        uint256 expired = _offerTo(a, 1, uint48(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(LockedSettlement.Expired.selector, expired));
        l.settlement.accept(expired);
        uint256 toA = _offerTo(a, 10, uint48(block.timestamp + 1 days));
        vm.prank(a);
        l.settlement.accept(toA);
        uint256 toB = _offerTo(b, 5, uint48(block.timestamp + 1 days));
        vm.prank(b);
        l.settlement.accept(toB);
        assertEq(l.note.balanceOf(a), 10);

        // §3.5. Transfers between eligible holders, while transfers are open.
        _send(a, b, 2);
        // An offer to sell that nobody takes: its unit stays locked to investor A.
        vm.prank(a);
        IERC20Like(address(l.note)).approve(address(l.settlement), 1);
        vm.prank(a);
        untaken = l.settlement.offer(LockedSettlement.Side.Sell, b, 1, 100_000, uint48(block.timestamp + 365 days));
        assertEq(l.note.getFrozenTokens(a), 1, "locked while offered");
    }

    function _date1() internal {
        // §4.1. Date 1 is determined from its date, in turn: not before, and not date 2 first.
        vm.warp(_obs(0).date - 1);
        uint256[] memory lv = _levels(9_000);
        (IDeterminationAgent.Outcome memory o,) = l.determinations.compute(0, lv);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CA_KEY, l.determinations.digest(0, lv, o));
        vm.expectRevert(abi.encodeWithSelector(IDeterminationAgent.BeforeScheduledDate.selector, 0, _obs(0).date));
        l.determinations.determine(0, lv, o, abi.encodePacked(r, s, v));
        vm.warp(_obs(0).date);
        vm.expectRevert(abi.encodeWithSelector(IDeterminationAgent.NotNextDate.selector, 1, 0));
        l.determinations.determine(1, lv, o, abi.encodePacked(r, s, v));
        o = _determine(0, 9_000); // 90%: coupon, no early redemption
        assertTrue(o.couponPaid && !o.redeemed);

        // §4.2. The Record Time fixes the holders of record, inclusive; a transfer after it does not count.
        vm.warp(_obs(0).recordTime);
        _send(b, a, 1); // at the Record Time: counts
        vm.warp(_obs(0).recordTime + 1);
        _send(a, b, 1); // after it: does not
        assertEq(l.recordDates.balanceAt(a, _obs(0).recordTime), 9);
        assertEq(l.recordDates.balanceAt(b, _obs(0).recordTime), 6);

        // §4.3. The coupon opens from the Payment Date, funded in one transfer from the Agent.
        uint48 payment = _obs(0).paymentDate;
        vm.prank(address(servicing));
        vm.expectRevert(abi.encodeWithSelector(PayingAgent.BeforePaymentDate.selector, payment));
        l.payingAgent.open(0, PayingAgent.Kind.Coupon);
        vm.warp(payment);
        vm.prank(address(servicing));
        vm.expectRevert(abi.encodeWithSelector(PayingAgent.NothingDue.selector, 0, PayingAgent.Kind.Redemption));
        l.payingAgent.open(0, PayingAgent.Kind.Redemption);
        vm.prank(address(servicing));
        bytes32 coupon = l.payingAgent.open(0, PayingAgent.Kind.Coupon);
        (,, uint64 entitled,,,,,,,) = l.payingAgent.distributions(coupon);
        assertEq(entitled, 15, "the units of record, the inventory's excluded");

        // §4.4, §4.5. Paid in batches to the holders of record, never the inventory; closed when reconciled.
        address[] memory inv = new address[](1);
        inv[0] = inventory;
        vm.prank(address(servicing));
        vm.expectRevert(PayingAgent.InventoryIsNotPaid.selector);
        l.payingAgent.pay(coupon, inv);
        uint256 aCash = d.deposit.balanceOf(a);
        _pay(coupon, a);
        _pay(coupon, b);
        assertEq(d.deposit.balanceOf(a) - aCash, 9 * 2_500, "nine units of record at EUR 25");
        (,,,,, bool closed,,,,) = l.payingAgent.distributions(coupon);
        assertTrue(closed, "closed when every unit entitled is paid");
    }

    function _date2Redeems() internal {
        // §4.2 at a possible redemption: transfers stop from date 2's Record Time until it is determined.
        vm.warp(_obs(1).recordTime + 1);
        assertFalse(l.determinations.transfersOpen(), "stopped: date 2 could redeem");
        vm.prank(a);
        vm.expectRevert();
        IERC20Like(address(l.note)).transfer(b, 1);

        // §5.1. Date 2 redeems early: the note terminates, transfers stay stopped, dates 3 and 4 fall away.
        IDeterminationAgent.Outcome memory o = _determine(1, 10_500);
        assertTrue(o.redeemed);
        assertTrue(l.determinations.terminated());
        assertFalse(l.determinations.transfersOpen(), "stopped for good");
        vm.warp(_obs(2).date);
        uint256[] memory lv = _levels(10_500);
        vm.expectRevert(IDeterminationAgent.Terminated.selector);
        l.determinations.determine(2, lv, o, "");
    }

    function _redemption() internal {
        // §5.2 to §5.4. The coupon, then the redemption: opening it pauses the note, paying burns, closing burns the inventory.
        vm.warp(_obs(1).paymentDate);
        vm.prank(address(servicing));
        bytes32 coupon2 = l.payingAgent.open(1, PayingAgent.Kind.Coupon);
        _pay(coupon2, a);
        _pay(coupon2, b);
        vm.prank(address(servicing));
        bytes32 redemption = l.payingAgent.open(1, PayingAgent.Kind.Redemption);
        assertTrue(l.note.paused(), "the redemption pauses the note");
        _pay(redemption, a);
        assertEq(l.note.balanceOf(a), 0, "burned as paid, the unit an offer locked included");
        _pay(redemption, b);
        assertEq(l.note.totalSupply(), 0, "the inventory burned on closing");

        // §5.5. An offer left open is released by anyone once the note is paused, its deadline not yet reached.
        vm.prank(makeAddr("anyone"));
        l.settlement.release(untaken);
        vm.prank(b);
        vm.expectRevert(abi.encodeWithSelector(LockedSettlement.NotOpen.selector, untaken));
        l.settlement.accept(untaken);
        assertEq(l.payingAgent.pending(), 0);
        assertEq(d.deposit.balanceOf(address(l.payingAgent)), 0, "the Paying Agent holds nothing");
    }
}
