// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {Test, Vm} from "forge-std/Test.sol";
import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {GovernanceController} from "../src/GovernanceController.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {StructuredNote} from "../src/StructuredNote.sol";
import {InstrumentGate} from "../src/InstrumentGate.sol";
import {Instruments} from "../script/Instruments.sol";
import {Lifecycle} from "../script/Lifecycle.sol";
import {Governance} from "../script/Governance.sol";
import {MockWallet, MockVenueChecker, MockVenueAdapter, MockCredentialGate} from "./Fixtures.sol";

/**
 * The governance controller and the ceremony: both tiers, both thresholds, both delays, recovery
 * with its veto, the worked example of reversal and restatement, and the renunciation.
 */
contract GovernanceTest is Test {
    Instruments.Deployed d;
    Lifecycle.Issued l;
    GovernanceController g;

    MockWallet agentGov;
    MockWallet issuerGov;
    MockWallet cosigner;
    MockWallet servicing;

    MockVenueChecker checker;
    MockVenueAdapter adapter;
    MockCredentialGate gate;

    uint256 caKey = 0xCA11;
    address deployer = address(this);
    address agent = makeAddr("interim Agent key");
    address accessIssuer = makeAddr("Access Issuer");
    address depositAgent = makeAddr("Deposit Agent");
    address inventory = makeAddr("Issuer inventory");
    address a = makeAddr("investor A");
    address b = makeAddr("investor B");

    uint256 constant T0 = 1_790_000_000;
    uint48 constant TIER2 = 72 hours;
    uint48 constant RECOVERY = 14 days;
    uint256[] initial;
    uint32 holder;

    function setUp() public {
        vm.warp(T0);
        d = Instruments.deploy(
            Instruments.Config(deployer, agent, accessIssuer, depositAgent, 3 * 365 days, 0, "", "N", "N", "D", "D")
        );
        initial = [uint256(451_200), 1_820_300, 25_000];
        l = Lifecycle.issue(d, _terms(), Lifecycle.Config(deployer, vm.addr(caKey), agent, inventory, agent));

        holder = d.registry.HOLD() | d.registry.RECEIVE() | d.registry.TRANSFER() | d.registry.SANCTIONS_CLEAR();
        _grant(a, holder | d.registry.REG_S());
        _grant(b, holder | d.registry.REG_S());
        _grant(inventory, holder | d.registry.REG_S());
        _grant(agent, holder);
        _grant(address(l.payingAgent), holder | d.registry.CONTRACT_ACCOUNT());
        vm.prank(depositAgent);
        d.gateway.credit(agent, 100_000_000_00, "funding");
        vm.startPrank(agent);
        d.deposit.approve(address(l.payingAgent), type(uint256).max);
        d.note.mint(inventory, 20);
        d.note.mint(a, 7);
        d.note.mint(b, 3);
        vm.stopPrank();

        agentGov = new MockWallet(2);
        issuerGov = new MockWallet(2);
        cosigner = new MockWallet(2);
        servicing = new MockWallet(2);
        address[] memory inst = new address[](3);
        inst[0] = address(agentGov);
        inst[1] = address(issuerGov);
        inst[2] = address(cosigner);
        checker = new MockVenueChecker(deployer);
        adapter = new MockVenueAdapter(deployer);
        gate = new MockCredentialGate(deployer);
        g = Governance.ceremony(
            d,
            l,
            Governance.Config(
                deployer,
                agent,
                inst,
                address(agentGov),
                address(servicing),
                2,
                4,
                TIER2,
                RECOVERY,
                Governance.Venue(address(checker), address(adapter), address(gate))
            )
        );
    }

    // --- helpers ---

    function _terms() internal view returns (IDeterminationAgent.Terms memory t) {
        t.initialLevels = initial;
        t.calculationAmountCents = 100_000;
        t.couponBarrierBps = 7_000;
        t.couponRateBps = 250;
        t.barrierBps = 6_000;
        t.schedule = new IDeterminationAgent.Observation[](2);
        for (uint256 k = 0; k < 2; ++k) {
            uint48 date = uint48(T0 + (k + 1) * 90 days);
            t.schedule[k] = IDeterminationAgent.Observation(date, date + 2 days, date + 5 days, true, false, k == 1, k == 1, 0);
        }
    }

    function _grant(address x, uint32 f) internal {
        vm.prank(accessIssuer);
        d.registry.grant(x, f, 276, uint40(T0 + 2 * 365 days), 0, 0);
    }

    function _via(MockWallet w, bytes memory data) internal returns (bytes memory) {
        return w.exec(address(g), data);
    }

    function _proposeAmend(MockWallet w, uint256 units) internal returns (uint256) {
        return abi.decode(
            _via(w, abi.encodeCall(GovernanceController.proposeAmendNotional, (true, units, "Tranche up by agreement"))),
            (uint256)
        );
    }

    function _approve(MockWallet w, uint256 id) internal {
        _via(w, abi.encodeCall(GovernanceController.approve, (id)));
    }

    // --- configuration ---

    function test_configurationIsChecked() public {
        address[] memory inst = new address[](3);
        inst[0] = address(agentGov);
        inst[1] = address(issuerGov);
        inst[2] = address(cosigner);
        GovernanceController.Config memory c = GovernanceController.Config(
            address(1),
            address(2),
            address(3),
            address(4),
            inst,
            address(agentGov),
            address(servicing),
            2,
            4,
            0,
            RECOVERY,
            address(0),
            address(0),
            address(0)
        );
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.InvalidConfiguration.selector, "Tier 2 delay is zero"));
        new GovernanceController(c);
        c.tier2Delay = RECOVERY;
        vm.expectRevert(
            abi.encodeWithSelector(GovernanceController.InvalidConfiguration.selector, "recovery delay not longer than Tier 2")
        );
        new GovernanceController(c);
        c.tier2Delay = TIER2;
        c.minSignatures = 1;
        vm.expectRevert(
            abi.encodeWithSelector(GovernanceController.InvalidConfiguration.selector, "fewer signatures than institutions")
        );
        new GovernanceController(c);
        c.minSignatures = 4;
        c.checker = address(checker);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.InvalidConfiguration.selector, "venue incomplete"));
        new GovernanceController(c);
    }

    // --- the ceremony ---

    /// The deployer and the interim Agent key hold nothing once the ceremony ends.
    function test_ceremonyLeavesTheDeployerAndInterimKeyWithNothing() public view {
        bytes32[12] memory noteRoles = [
            bytes32(0x00), d.note.PROXY_UPGRADE_ROLE(), d.note.MINTER_ROLE(), d.note.BURNER_ROLE(),
            d.note.PAUSER_ROLE(), d.note.ENFORCER_ROLE(), d.note.ERC20ENFORCER_ROLE(), d.note.SNAPSHOOTER_ROLE(),
            d.note.DOCUMENT_ROLE(), d.note.EXTRA_INFORMATION_ROLE(), d.note.FORCED_TRANSFER_ROLE(), d.note.FORCED_TRANSFER_ROLE()
        ];
        address[2] memory gone = [deployer, agent];
        for (uint256 i; i < gone.length; ++i) {
            for (uint256 k; k < noteRoles.length; ++k) assertFalse(d.note.hasRole(noteRoles[k], gone[i]), "note role");
            assertFalse(d.deposit.hasRole(0x00, gone[i]), "deposit admin");
            assertFalse(d.deposit.hasRole(d.deposit.PROXY_UPGRADE_ROLE(), gone[i]), "deposit upgrade");
            assertFalse(d.registry.hasRole(0x00, gone[i]), "registry admin");
            assertFalse(l.payingAgent.hasRole(0x00, gone[i]), "Paying Agent admin");
            assertFalse(l.payingAgent.hasRole(l.payingAgent.PAYER_ROLE(), gone[i]), "payer");
            assertFalse(d.gateway.hasRole(0x00, gone[i]), "gateway admin");
        }
    }

    function test_ceremonyPlacesEachPower() public view {
        address c = address(g);
        assertTrue(d.note.hasRole(0x00, c));
        assertTrue(d.note.hasRole(d.note.PROXY_UPGRADE_ROLE(), c));
        assertTrue(d.note.hasRole(d.note.FORCED_TRANSFER_ROLE(), c));
        assertTrue(d.note.hasRole(d.note.MINTER_ROLE(), c), "notional amendment is Tier 2");
        assertFalse(d.note.hasRole(d.note.MINTER_ROLE(), address(servicing)), "servicing cannot mint");
        assertTrue(d.note.hasRole(d.note.PAUSER_ROLE(), address(servicing)));
        assertTrue(l.payingAgent.hasRole(l.payingAgent.PAYER_ROLE(), address(servicing)));
        assertTrue(d.registry.hasRole(d.registry.SUPERVISOR_ROLE(), c));
        assertTrue(d.deposit.hasRole(d.deposit.FORCED_TRANSFER_ROLE(), address(l.payingAgent)));
        assertFalse(d.note.hasRole(d.note.SNAPSHOOTER_ROLE(), c), "the record-date engine is fixed");
        assertFalse(d.note.hasRole(d.note.EXTRA_INFORMATION_ROLE(), c), "the terms are fixed");
    }

    // --- Tier 1 ---

    function test_tier1IsTheAgentGovernanceWalletAlone() public {
        string memory reason = "Register correction: units delivered to investor B's old address";
        vm.recordLogs();
        _via(agentGov, abi.encodeCall(GovernanceController.correctRegister, (a, b, 2, reason)));
        assertEq(d.note.balanceOf(b), 5);
        bool found;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 k; k < logs.length; ++k) {
            if (logs[k].topics[0] == keccak256("Tier1(string,string)")) {
                (, string memory r) = abi.decode(logs[k].data, (string, string));
                found = keccak256(bytes(r)) == keccak256(bytes(reason));
            }
        }
        assertTrue(found, "reason emitted in full");

        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotAgentGovernance.selector, address(issuerGov)));
        _via(issuerGov, abi.encodeCall(GovernanceController.correctRegister, (a, b, 1, reason)));
        vm.expectRevert(GovernanceController.NoReason.selector);
        _via(agentGov, abi.encodeCall(GovernanceController.correctRegister, (a, b, 1, "")));
    }

    function test_tier1WithdrawsAGrant() public {
        _via(agentGov, abi.encodeCall(GovernanceController.withdrawGrant, (b, "Sanctions designation")));
        (uint32 f,) = d.registry.liveFlags(b);
        assertEq(f, 0);
    }

    // --- Tier 2: two thresholds ---

    function test_oneInstitutionCannotQueue() public {
        uint256 id = _proposeAmend(agentGov, 5);
        assertEq(g.proposal(id).readyAt, 0);
        (uint256 inst, uint256 sigs) = g.approvals(id);
        assertEq(inst, 1);
        assertEq(sigs, 2);
    }

    /// Four signatures in one firm is not two institutions.
    function test_fourSignaturesInOneFirmAreNotEnough() public {
        agentGov.setThreshold(4);
        uint256 id = _proposeAmend(agentGov, 5);
        assertEq(g.proposal(id).readyAt, 0, "institution count not met");
    }

    /// Two institutions whose wallets need only one signature each are not four signatures.
    function test_twoInstitutionsWithWeakWalletsAreNotEnough() public {
        agentGov.setThreshold(1);
        issuerGov.setThreshold(1);
        uint256 id = _proposeAmend(agentGov, 5);
        _approve(issuerGov, id);
        assertEq(g.proposal(id).readyAt, 0, "signature count not met");
    }

    function test_twoOfThreeQueueAndExecuteAfterTheDelay() public {
        uint256 id = _proposeAmend(agentGov, 5);
        _approve(cosigner, id);
        uint48 readyAt = g.proposal(id).readyAt;
        assertEq(readyAt, block.timestamp + TIER2);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotReady.selector, readyAt));
        g.execute(id);
        vm.warp(readyAt);
        g.execute(id);
        assertEq(d.note.balanceOf(inventory), 25, "tranched up into inventory");
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotOpen.selector, id));
        g.execute(id);
    }

    /// Thresholds are checked again at execution.
    function test_thresholdsRecheckedAtExecution() public {
        uint256 id = _proposeAmend(agentGov, 5);
        _approve(issuerGov, id);
        issuerGov.setThreshold(1);
        vm.warp(block.timestamp + TIER2);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.ThresholdsNotMet.selector, 2, 3));
        g.execute(id);
    }

    function test_onlyTheProposerCancels() public {
        uint256 id = _proposeAmend(agentGov, 5);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotCancellable.selector, address(issuerGov)));
        _via(issuerGov, abi.encodeCall(GovernanceController.cancel, (id)));
        _via(agentGov, abi.encodeCall(GovernanceController.cancel, (id)));
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotOpen.selector, id));
        _approve(issuerGov, id);
    }

    function test_onlyInstitutionsPropose() public {
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotAnInstitution.selector, address(servicing)));
        servicing.exec(address(g), abi.encodeCall(GovernanceController.proposeAmendNotional, (true, 1, "x")));
    }

    // --- recovery (ADR 0019) ---

    function test_recoveryNeedsEveryOtherInstitutionAndTheLongerDelay() public {
        MockWallet replacement = new MockWallet(2);
        uint256 id = abi.decode(
            _via(
                issuerGov,
                abi.encodeCall(
                    GovernanceController.proposeReplaceInstitution, (address(agentGov), address(replacement), "Agent wallet lost")
                )
            ),
            (uint256)
        );
        assertEq(g.proposal(id).readyAt, 0, "the co-signer has not approved");
        _approve(cosigner, id);
        assertEq(g.proposal(id).readyAt, block.timestamp + RECOVERY);
        vm.warp(block.timestamp + RECOVERY);
        g.execute(id);
        assertTrue(g.isInstitution(address(replacement)));
        assertFalse(g.isInstitution(address(agentGov)));
        assertEq(g.agentGovernance(), address(replacement), "Tier 1 moves with the Agent's seat");
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotAgentGovernance.selector, address(agentGov)));
        _via(agentGov, abi.encodeCall(GovernanceController.withdrawGrant, (b, "x")));
    }

    /// A wallet that still works can veto its own replacement.
    function test_theOldWalletVetoesRecovery() public {
        MockWallet replacement = new MockWallet(2);
        uint256 id = abi.decode(
            _via(
                issuerGov,
                abi.encodeCall(
                    GovernanceController.proposeReplaceInstitution, (address(cosigner), address(replacement), "Co-signer lost")
                )
            ),
            (uint256)
        );
        _approve(agentGov, id);
        _via(cosigner, abi.encodeCall(GovernanceController.cancel, (id)));
        vm.warp(block.timestamp + RECOVERY);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotOpen.selector, id));
        g.execute(id);
    }

    // --- servicing wallet ---

    function test_servicingWalletIsReplacedAsOneAct() public {
        MockWallet fresh = new MockWallet(2);
        uint256 id = abi.decode(
            _via(agentGov, abi.encodeCall(GovernanceController.proposeReplaceServicingWallet, (address(fresh), "Rotation"))),
            (uint256)
        );
        _approve(issuerGov, id);
        vm.warp(block.timestamp + TIER2);
        g.execute(id);
        assertTrue(l.payingAgent.hasRole(l.payingAgent.PAYER_ROLE(), address(fresh)));
        assertFalse(l.payingAgent.hasRole(l.payingAgent.PAYER_ROLE(), address(servicing)));
        assertTrue(d.note.hasRole(d.note.PAUSER_ROLE(), address(fresh)));
        assertFalse(d.note.hasRole(d.note.PAUSER_ROLE(), address(servicing)));
    }

    // --- the worked example: reversal and restatement (ADR 0014) ---

    function test_wrongRecordTimeIsReversedAndRestated() public {
        IDeterminationAgent.Observation memory o = l.determinations.observation(0);
        vm.warp(o.date);
        uint256[] memory lv = new uint256[](3);
        for (uint256 k; k < 3; ++k) lv[k] = initial[k] * 9_000 / 10_000;
        (IDeterminationAgent.Outcome memory out,) = l.determinations.compute(0, lv);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(caKey, l.determinations.digest(0, lv, out));
        l.determinations.determine(0, lv, out, abi.encodePacked(r, s, v));

        // Investor A sells to B after the calendar's Record Time, before the true one.
        vm.warp(o.recordTime + 1 hours);
        vm.prank(a);
        d.note.transfer(b, 7);
        uint48 trueRecordTime = o.recordTime + 1 days;

        vm.warp(o.paymentDate);
        address[] memory both = new address[](2);
        both[0] = a;
        both[1] = b;
        bytes32 id = abi.decode(
            servicing.exec(address(l.payingAgent), abi.encodeCall(PayingAgent.open, (0, PayingAgent.Kind.Coupon))),
            (bytes32)
        );
        servicing.exec(address(l.payingAgent), abi.encodeCall(PayingAgent.pay, (id, both)));
        assertEq(d.deposit.balanceOf(a), 7 * 2_500, "A was paid on the wrong Record Time");

        // Tier 2: reverse, with the reason in writing.
        string memory reason = "Coupon 1 paid on the 23rd; the terms fix the 25th";
        uint256 p = abi.decode(
            _via(agentGov, abi.encodeCall(GovernanceController.proposeReverseDistribution, (id, both, reason))), (uint256)
        );
        _approve(issuerGov, p);
        vm.warp(block.timestamp + TIER2);
        g.execute(p);
        assertEq(d.deposit.balanceOf(a), 0, "reversed against the original credit");
        (,,,,,,, bool reversed,,) = l.payingAgent.distributions(id);
        assertTrue(reversed, "the original stays on record, marked reversed");

        // Tier 2: restate at the true Record Time.
        uint256 q = abi.decode(
            _via(agentGov, abi.encodeCall(GovernanceController.proposeRestateDistribution, (id, trueRecordTime, reason))),
            (uint256)
        );
        _approve(cosigner, q);
        vm.warp(block.timestamp + TIER2);
        g.execute(q);
        bytes32 restated = keccak256(abi.encode(id, trueRecordTime));
        address[] memory onlyB = new address[](1);
        onlyB[0] = b;
        servicing.exec(address(l.payingAgent), abi.encodeCall(PayingAgent.pay, (restated, onlyB)));
        assertEq(d.deposit.balanceOf(b), 10 * 2_500, "B, the holder at the true Record Time, is paid for all ten");
        assertEq(d.deposit.balanceOf(a), 0);
    }

    // --- upgrade and gate replacement ---

    function test_upgradeIsTier2() public {
        address impl = address(new StructuredNote());
        uint256 id = abi.decode(
            _via(agentGov, abi.encodeCall(GovernanceController.proposeUpgrade, (address(d.note), impl, "Fix"))), (uint256)
        );
        _approve(issuerGov, id);
        vm.warp(block.timestamp + TIER2);
        g.execute(id);
        bytes32 slot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        assertEq(address(uint160(uint256(vm.load(address(d.note), slot)))), impl);
    }

    function test_onlyTheGovernedTokens() public {
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotGoverned.selector, address(d.registry)));
        _via(agentGov, abi.encodeCall(GovernanceController.proposeUpgrade, (address(d.registry), address(1), "x")));
    }

    function test_gateReplacementIsTier2() public {
        InstrumentGate next = new InstrumentGate(d.registry, 0, 0, 0, new uint16[](0));
        uint256 id = abi.decode(
            _via(
                agentGov,
                abi.encodeCall(GovernanceController.proposeReplaceGate, (address(d.deposit), address(next), "New mask"))
            ),
            (uint256)
        );
        _approve(issuerGov, id);
        vm.warp(block.timestamp + TIER2);
        g.execute(id);
        assertEq(address(d.deposit.ruleEngine()), address(next));
    }

    // --- the venue (ADR 0039) ---

    function _tier2(MockWallet proposer, bytes memory proposal) internal {
        uint256 id = abi.decode(_via(proposer, proposal), (uint256));
        _approve(cosigner, id);
        vm.warp(block.timestamp + TIER2);
        g.execute(id);
    }

    /// The ceremony hands the venue to the controller and leaves the deployer nothing on it.
    function test_ceremonyHandsOverTheVenue() public view {
        assertEq(checker.owner(), address(g), "checker");
        assertEq(adapter.owner(), address(g), "adapter");
        assertTrue(gate.hasRole(0x00, address(g)), "gate admin");
        assertTrue(gate.hasRole(gate.SUPERVISOR_ROLE(), address(g)), "gate supervisor");
        assertFalse(gate.hasRole(0x00, deployer), "the deployer renounced the gate");
        assertEq(g.credentialGate(), address(gate));
    }

    /// Only the servicing wallet switches swapping, and it needs no approval or delay.
    function test_servicingSwitchesSwapping() public {
        _via(servicing, abi.encodeCall(GovernanceController.setVenueSwapping, (false)));
        assertFalse(adapter.swappingEnabled(), "off at once");
        _via(servicing, abi.encodeCall(GovernanceController.setVenueSwapping, (true)));
        assertTrue(adapter.swappingEnabled(), "and back on");

        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotServicingWallet.selector, address(agentGov)));
        _via(agentGov, abi.encodeCall(GovernanceController.setVenueSwapping, (false)));
    }

    /// Pool access is withdrawn at Tier 1, with its reason carried to the gate whole.
    function test_tier1WithdrawsPoolAccess() public {
        string memory reason = "Adverse media match under review; pool access suspended pending the outcome";
        _via(agentGov, abi.encodeCall(GovernanceController.withdrawPoolAccess, (b, reason)));
        assertEq(gate.withdrawnFor(b), reason);

        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotAgentGovernance.selector, address(cosigner)));
        _via(cosigner, abi.encodeCall(GovernanceController.withdrawPoolAccess, (b, reason)));
        vm.expectRevert(GovernanceController.NoReason.selector);
        _via(agentGov, abi.encodeCall(GovernanceController.withdrawPoolAccess, (b, "")));
    }

    /// Repointing the credential gate is Tier 2, and later withdrawals go to the new gate.
    function test_repointingTheCredentialGateIsTier2() public {
        MockCredentialGate next = new MockCredentialGate(address(g));
        bytes32 supervisor = next.SUPERVISOR_ROLE();
        vm.prank(address(g));
        next.grantRole(supervisor, address(g));

        bytes memory proposal =
            abi.encodeCall(GovernanceController.proposeSetCredentialGate, (address(next), "Issuer deactivated; new policy"));
        uint256 id = abi.decode(_via(agentGov, proposal), (uint256));
        assertEq(g.proposal(id).readyAt, 0, "one institution cannot queue");
        _approve(issuerGov, id);
        vm.warp(block.timestamp + TIER2);
        g.execute(id);

        assertEq(checker.credentialGate(address(d.deposit)), address(next), "the checker reads the new gate");
        assertEq(g.credentialGate(), address(next));
        _via(agentGov, abi.encodeCall(GovernanceController.withdrawPoolAccess, (a, "Withdrawn on the new gate")));
        assertEq(next.withdrawnFor(a), "Withdrawn on the new gate");
    }

    function test_liquidityProviderIsTier2() public {
        address lp = makeAddr("second liquidity provider");
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeSetLiquidityProvider, (lp, true, "Second provider")));
        assertTrue(checker.liquidityApproved(address(d.deposit), lp));
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeSetLiquidityProvider, (lp, false, "Mandate ended")));
        assertFalse(checker.liquidityApproved(address(d.deposit), lp));
    }

    function test_routersAndHooksAreTier2() public {
        address router = makeAddr("router");
        address hook = makeAddr("hook");
        _tier2(issuerGov, abi.encodeCall(GovernanceController.proposeSetVenueWrapper, (router, true, "Router allowed")));
        _tier2(issuerGov, abi.encodeCall(GovernanceController.proposeSetVenueHook, (hook, true, "Hook allowed")));
        assertTrue(adapter.allowedWrappers(router));
        assertTrue(adapter.allowedHooks(hook));
    }

    function test_poolAttesterIsTier2() public {
        address attester = makeAddr("second attester");
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeSetPoolAttester, (attester, true, "Second attester")));
        assertTrue(gate.hasRole(gate.ATTESTER_ROLE(), attester));
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeSetPoolAttester, (attester, false, "Key retired")));
        assertFalse(gate.hasRole(gate.ATTESTER_ROLE(), attester));
    }

    /// A controller with no venue refuses every venue act.
    function test_noVenueRefusesVenueActs() public {
        address[] memory inst = g.institutions();
        GovernanceController bare = new GovernanceController(
            GovernanceController.Config(
                address(d.note),
                address(d.deposit),
                address(d.registry),
                address(l.payingAgent),
                inst,
                address(agentGov),
                address(servicing),
                2,
                4,
                TIER2,
                RECOVERY,
                address(0),
                address(0),
                address(0)
            )
        );
        vm.expectRevert(GovernanceController.NoVenue.selector);
        bare.acceptVenueOwnership();
        vm.prank(address(servicing));
        vm.expectRevert(GovernanceController.NoVenue.selector);
        bare.setVenueSwapping(false);
    }
}
