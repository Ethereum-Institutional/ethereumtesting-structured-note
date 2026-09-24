// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {IRuleEngine} from "debt-standard/interfaces/engine/IRuleEngine.sol";
import {ICMTATBase} from "debt-standard/interfaces/tokenization/ICMTAT.sol";
import {IDepositGateway} from "../src/interfaces/IDepositGateway.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {Instruments} from "../script/Instruments.sol";

/**
 * The instruments as deployed, on the real registry and gates, wired by the same library the
 * deploy script uses.
 */
contract InstrumentsTest is Test {
    Instruments.Deployed d;
    address agent = makeAddr("Agent");
    address accessIssuer = makeAddr("Access Issuer");
    address depositAgent = makeAddr("Deposit Agent");
    address issuer = makeAddr("Issuer inventory");
    address investorA = makeAddr("investor A");
    address investorB = makeAddr("investor B");
    address cashOnly = makeAddr("eligible for the cash leg, not the note");
    address nobody = makeAddr("never onboarded");

    bytes32 constant TERMS = keccak256("term sheet v1");

    function setUp() public {
        vm.warp(1_790_000_000);
        d = Instruments.deploy(
            Instruments.Config({
                deployer: address(this),
                agent: agent,
                accessIssuer: accessIssuer,
                depositAgent: depositAgent,
                maxValidity: 365 days,
                termSheetHash: TERMS,
                termSheetUri: "ipfs://term-sheet",
                noteName: "Note",
                noteSymbol: "NOTE",
                depositName: "Deposit",
                depositSymbol: "DEP"
            })
        );
        IdentityRegistry r = d.registry;
        uint32 holder = r.HOLD() | r.RECEIVE() | r.TRANSFER() | r.SANCTIONS_CLEAR();
        _grant(issuer, holder | r.REG_S());
        _grant(investorA, holder | r.REG_S() | r.PROFESSIONAL());
        _grant(investorB, holder | r.REG_S());
        _grant(cashOnly, holder);
    }

    function _grant(address a, uint32 flags) internal {
        vm.prank(accessIssuer);
        d.registry.grant(a, flags, 276, uint40(block.timestamp) + 90 days, keccak256(abi.encode(a)), 0);
    }

    function _credit(address a, uint256 amount, bytes32 ref) internal {
        vm.prank(depositAgent);
        d.gateway.credit(a, amount, ref);
    }

    // --- wiring ---

    function test_unitsAndDecimals() public view {
        assertEq(d.note.decimals(), 0, "a balance is a count of EUR 1,000 units");
        assertEq(d.deposit.decimals(), 2);
    }

    function test_eachTokenPointsAtItsOwnGate() public view {
        assertEq(address(d.note.ruleEngine()), address(d.noteGate));
        assertEq(address(d.deposit.ruleEngine()), address(d.depositGate));
        assertEq(address(d.noteGate.REGISTRY()), address(d.registry));
        assertEq(address(d.depositGate.REGISTRY()), address(d.registry), "one whitelist of record");
    }

    function test_termSheetAnchoredByHash() public view {
        ICMTATBase.CMTATTerms memory t = d.note.terms();
        assertEq(t.doc.documentHash, TERMS);
    }

    /// Upgrade, forced transfer and supervisory withdrawal wait for the Wave 4 controller.
    function test_noOneHoldsTheControllerPowers() public view {
        bytes32 up = d.note.PROXY_UPGRADE_ROLE();
        bytes32 forced = d.note.FORCED_TRANSFER_ROLE();
        bytes32 supervisor = d.registry.SUPERVISOR_ROLE();
        address[5] memory who = [address(this), agent, accessIssuer, depositAgent, address(d.gateway)];
        for (uint256 i; i < who.length; ++i) {
            assertFalse(d.note.hasRole(up, who[i]));
            assertFalse(d.deposit.hasRole(up, who[i]));
            assertFalse(d.note.hasRole(forced, who[i]));
            assertFalse(d.deposit.hasRole(forced, who[i]));
            assertFalse(d.registry.hasRole(supervisor, who[i]));
        }
    }

    function test_namesComeFromConfiguration() public view {
        assertEq(d.note.symbol(), "NOTE");
        assertEq(d.deposit.name(), "Deposit");
    }

    function test_deployerHoldsAdminOnly() public view {
        assertTrue(d.note.hasRole(0x00, address(this)));
        assertFalse(d.note.hasRole(d.note.MINTER_ROLE(), address(this)));
        assertFalse(d.note.hasRole(d.note.FORCED_TRANSFER_ROLE(), address(this)));
    }

    // --- one whitelist, two instruments ---

    function test_noteNeedsRegulationS() public {
        _credit(cashOnly, 1_000_00, "booking-1");
        assertEq(d.deposit.balanceOf(cashOnly), 1_000_00, "may hold the cash leg");
        assertFalse(d.note.canReceive(cashOnly), "may not hold the note");
        vm.prank(agent);
        vm.expectRevert();
        d.note.mint(cashOnly, 1);
    }

    function test_issueToInventoryThenPlace() public {
        vm.prank(agent);
        d.note.mint(issuer, 100);
        vm.prank(issuer);
        d.note.transfer(investorA, 10);
        assertEq(d.note.balanceOf(issuer), 90, "pending inventory");
        assertEq(d.note.balanceOf(investorA), 10, "live");
        assertEq(d.note.holderCount(), 2);
        assertTrue(d.note.isHolder(investorA));
    }

    function test_lapsedGrantStopsTransfersToAndFrom() public {
        vm.prank(agent);
        d.note.mint(investorA, 5);
        vm.warp(block.timestamp + 90 days);
        vm.prank(investorA);
        vm.expectRevert();
        d.note.transfer(investorB, 1);
    }

    function test_revocationStopsTransfersAtOnce() public {
        vm.prank(agent);
        d.note.mint(investorA, 5);
        vm.prank(accessIssuer);
        d.registry.revoke(investorB);
        vm.prank(investorA);
        vm.expectRevert();
        d.note.transfer(investorB, 1);
    }

    /// G3 default: the Agent can redeem a holder whose grant has lapsed by maturity.
    function test_redemptionBurnsForALapsedHolder() public {
        vm.prank(agent);
        d.note.mint(investorA, 5);
        vm.warp(block.timestamp + 90 days);
        vm.prank(agent);
        d.note.burn(investorA, 5);
        assertEq(d.note.totalSupply(), 0, "zero positions");
    }

    // --- deposit gateway ---

    function test_creditAndDebitCarryTheirBooking() public {
        vm.expectEmit(true, true, false, true, address(d.gateway));
        emit IDepositGateway.Credited(investorA, 5_000_00, "booking-1");
        _credit(investorA, 5_000_00, "booking-1");
        vm.prank(depositAgent);
        d.gateway.debit(investorA, 1_000_00, "booking-2");
        assertEq(d.deposit.balanceOf(investorA), 4_000_00);
        assertTrue(d.gateway.booked("booking-1"));
    }

    function test_aBookingCannotBeReplayed() public {
        _credit(investorA, 1, "booking-1");
        vm.prank(depositAgent);
        vm.expectRevert(abi.encodeWithSelector(IDepositGateway.ReferenceUsed.selector, bytes32("booking-1")));
        d.gateway.credit(investorA, 1, "booking-1");
        vm.prank(depositAgent);
        vm.expectRevert(IDepositGateway.ZeroReference.selector);
        d.gateway.credit(investorA, 1, bytes32(0));
    }

    function test_creditToAnAccountThatCannotReceiveReverts() public {
        vm.prank(depositAgent);
        vm.expectRevert();
        d.gateway.credit(nobody, 1, "booking-1");
        assertFalse(d.gateway.booked("booking-1"), "nothing booked when the credit fails");
    }

    function test_onlyTheGatewayCreatesDeposit() public {
        vm.prank(depositAgent);
        vm.expectRevert();
        d.deposit.mint(investorA, 1);
        vm.prank(agent);
        vm.expectRevert();
        d.gateway.credit(investorA, 1, "booking-1");
    }

    /// A debit never reaches the frozen part of a balance.
    function test_debitCannotTakeTheFrozenPart() public {
        _credit(investorA, 100, "booking-1");
        vm.prank(depositAgent);
        d.deposit.setFrozenTokens(investorA, 60);
        vm.prank(depositAgent);
        vm.expectRevert();
        d.gateway.debit(investorA, 41, "booking-2");
        vm.prank(depositAgent);
        d.gateway.debit(investorA, 40, "booking-3");
        assertEq(d.deposit.balanceOf(investorA), 60);
    }

    /// The deposit's gate is replaceable only by its admin, and replacement is on the record.
    function test_gateReplacementIsAnAdminAct() public {
        vm.prank(depositAgent);
        vm.expectRevert();
        d.deposit.setRuleEngine(IRuleEngine(address(0xBEEF)));
    }
}
