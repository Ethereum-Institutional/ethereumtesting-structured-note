// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Vm} from "forge-std/Test.sol";
import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {AgentRestrictions, IOwnable2Step, INote} from "../src/interfaces/INote.sol";
import {GovernanceController} from "../src/GovernanceController.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {FixedImplementationAuthority} from "../src/FixedImplementationAuthority.sol";
import {ClaimTopics} from "../src/claims/ClaimTopics.sol";
import {ExpiringClaimIssuer} from "../src/claims/ExpiringClaimIssuer.sol";
import {Governance} from "../script/Governance.sol";
import {Issuance} from "../script/Issuance.sol";
import {Stack, IERC20Like} from "./Stack.sol";
import {MockWallet, MockVenueChecker, MockVenueAdapter, MockCredentialGate} from "./Mocks.sol";

interface IProxyAuthority {
    function getImplementationAuthority() external view returns (address);
    function setImplementationAuthority(address) external;
}

interface IRoles {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

interface ITrusted {
    function isTrustedIssuer(address issuer) external view returns (bool);
    function hasClaimTopic(address issuer, uint256 topic) external view returns (bool);
}

/**
 * The governance controller and the ceremony on the ERC-3643 note: both tiers, both thresholds,
 * both delays, recovery with its veto, the worked example of reversal and restatement, and the
 * renunciation.
 */
contract GovernanceTest is Stack {
    GovernanceController g;

    MockWallet agentGov;
    MockWallet issuerGov;
    MockWallet cosigner;
    MockWallet servicing;

    MockVenueChecker checker;
    MockVenueAdapter adapter;
    MockCredentialGate gate;

    address deployer = address(this);
    address a = makeAddr("investor A");
    address b = makeAddr("investor B");

    uint48 constant TIER2 = 72 hours;
    uint48 constant RECOVERY = 14 days;
    uint48 constant WINDOW = 7 days;

    function setUp() public {
        vm.warp(T0);
        _deployScaffolding();
        initial = [uint256(451_200), 1_820_300, 25_000];
        l = _issueNote("note", _twoDates());
        _onboard(inventory, true);
        _onboard(agent, true);
        _onboard(a, true);
        _onboard(b, true);
        _credit(agent, 100_000_000_00);
        vm.prank(agent);
        IERC20Like(address(d.deposit)).approve(address(l.payingAgent), type(uint256).max);
        vm.startPrank(inventory);
        l.note.mint(inventory, 20);
        l.note.mint(a, 7);
        l.note.mint(b, 3);
        l.note.unpause();
        vm.stopPrank();

        agentGov = new MockWallet(2);
        issuerGov = new MockWallet(2);
        cosigner = new MockWallet(2);
        servicing = new MockWallet(2);
        checker = new MockVenueChecker(deployer);
        adapter = new MockVenueAdapter(deployer);
        gate = new MockCredentialGate(deployer);
        g = Governance.ceremony(
            d,
            l,
            Governance.Config(
                deployer,
                inventory,
                agent,
                _institutions(),
                address(agentGov),
                address(servicing),
                2,
                4,
                TIER2,
                RECOVERY,
                WINDOW,
                Governance.Venue(address(checker), address(adapter), address(gate))
            )
        );
    }

    // --- helpers ---

    function _institutions() internal view returns (address[] memory inst) {
        inst = new address[](3);
        inst[0] = address(agentGov);
        inst[1] = address(issuerGov);
        inst[2] = address(cosigner);
    }

    /// Two dates: a coupon on the first, the final date on the second.
    function _twoDates() internal view returns (IDeterminationAgent.Terms memory t) {
        t = _terms();
        IDeterminationAgent.Observation[] memory s = new IDeterminationAgent.Observation[](2);
        for (uint256 k = 0; k < 2; ++k) {
            uint48 date = uint48(T0 + (k + 1) * 90 days);
            s[k] = IDeterminationAgent.Observation(date, date + 2 days, date + 5 days, true, false, k == 1, k == 1, 0);
        }
        t.schedule = s;
    }

    function _config(address checker_, uint48 window) internal view returns (GovernanceController.Config memory) {
        return GovernanceController.Config(
            address(l.note),
            address(d.deposit),
            l.trustedIssuers,
            address(l.recordDates),
            address(l.payingAgent),
            _institutions(),
            address(agentGov),
            address(servicing),
            2,
            4,
            TIER2,
            RECOVERY,
            window,
            checker_,
            checker_ == address(0) ? address(0) : address(adapter),
            checker_ == address(0) ? address(0) : address(gate)
        );
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

    function _same(AgentRestrictions memory x, AgentRestrictions memory y) internal pure returns (bool) {
        return keccak256(abi.encode(x)) == keccak256(abi.encode(y));
    }

    // --- configuration ---

    function test_configurationIsChecked() public {
        GovernanceController.Config memory c = _config(address(0), WINDOW);
        c.tier2Delay = 0;
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

    /// The deployer and the interim keys hold nothing on the note or its lifecycle once the
    /// ceremony ends.
    function test_ceremonyLeavesTheDeployerAndInterimKeyWithNothing() public view {
        address[3] memory gone = [deployer, agent, inventory];
        address[5] memory owned =
            [address(l.note), address(l.identityRegistry), l.trustedIssuers, l.claimTopics, l.compliance];
        for (uint256 i; i < gone.length; ++i) {
            assertFalse(l.note.isAgent(gone[i]), "note agent");
            for (uint256 k; k < owned.length; ++k) assertTrue(IOwnable2Step(owned[k]).owner() != gone[i], "owner");
            assertFalse(IRoles(address(d.deposit)).hasRole(0x00, gone[i]), "deposit admin");
            assertFalse(l.payingAgent.hasRole(0x00, gone[i]), "Paying Agent admin");
            assertFalse(l.payingAgent.hasRole(l.payingAgent.PAYER_ROLE(), gone[i]), "payer");
            assertFalse(IRoles(address(d.gateway)).hasRole(0x00, gone[i]), "gateway admin");
        }
    }

    function test_ceremonyPlacesEachPower() public view {
        address c = address(g);
        address[5] memory owned =
            [address(l.note), address(l.identityRegistry), l.trustedIssuers, l.claimTopics, l.compliance];
        for (uint256 k; k < owned.length; ++k) assertEq(IOwnable2Step(owned[k]).owner(), c, "the controller owns the suite");
        assertTrue(l.note.isAgent(c));
        assertTrue(_same(l.note.getAgentRestrictions(c), Issuance.controllerRestrictions()), "controller restricted");
        assertTrue(l.note.isAgent(address(servicing)));
        assertTrue(_same(l.note.getAgentRestrictions(address(servicing)), g.servicingRestrictions()), "servicing restricted");
        assertTrue(l.note.getAgentRestrictions(address(servicing)).disableMint, "servicing cannot mint");
        assertTrue(_same(l.note.getAgentRestrictions(address(l.payingAgent)), Issuance.payingAgentRestrictions()));
        assertTrue(_same(l.note.getAgentRestrictions(address(l.settlement)), Issuance.settlementRestrictions()));
        assertTrue(l.payingAgent.hasRole(l.payingAgent.PAYER_ROLE(), address(servicing)));
        assertTrue(IRoles(address(d.deposit)).hasRole(d.deposit.FORCED_TRANSFER_ROLE(), address(l.payingAgent)));
        assertTrue(INote(address(l.identityRegistry)).isAgent(onboardingAgent), "the onboarding agent registers identities");
    }

    /// The note's logic is fixed: its proxies answer to an authority that can switch nothing,
    /// and no one else can repoint them.
    function test_noteLogicIsFixed() public {
        address authority = IProxyAuthority(address(l.note)).getImplementationAuthority();
        assertEq(authority, address(d.trexAuthority));
        vm.expectRevert();
        IProxyAuthority(address(l.note)).setImplementationAuthority(address(1));
        vm.prank(address(g));
        vm.expectRevert();
        IProxyAuthority(address(l.note)).setImplementationAuthority(address(1));
    }

    // --- Tier 1 ---

    function test_tier1IsTheAgentGovernanceWalletAlone() public {
        string memory reason = "Register correction: units delivered to investor B's old address";
        vm.recordLogs();
        _via(agentGov, abi.encodeCall(GovernanceController.correctRegister, (a, b, 2, reason)));
        assertEq(l.note.balanceOf(b), 5);
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

    /// The supervisory stop: an account frozen at once, whichever institution vouched for it.
    function test_tier1FreezesAnAccount() public {
        _via(agentGov, abi.encodeCall(GovernanceController.freezeAccount, (b, true, "Sanctions designation")));
        assertTrue(l.note.isFrozen(b));
        vm.prank(b);
        vm.expectRevert();
        IERC20Like(address(l.note)).transfer(a, 1);
        _via(agentGov, abi.encodeCall(GovernanceController.freezeAccount, (b, false, "Designation lifted")));
        assertFalse(l.note.isFrozen(b));
    }

    /// S-25: a holder's units recovered from its lost wallet to a new one, the identity moved
    /// with them and the record dates kept in step; never while transfers are stopped.
    function test_tier1RecoversALostWallet() public {
        address replacement = makeAddr("investor B, new wallet");
        address id = address(l.identityRegistry.identity(b));
        _via(agentGov, abi.encodeCall(GovernanceController.recoverWallet, (b, replacement, id, "Key lost")));
        assertEq(l.note.balanceOf(replacement), 3);
        assertEq(l.note.balanceOf(b), 0);
        assertEq(address(l.identityRegistry.identity(replacement)), id, "the identity moves with the units");
        assertFalse(l.identityRegistry.contains(b), "the lost wallet is removed");
        assertEq(l.recordDates.balanceAt(replacement, block.timestamp), 3, "the record dates follow");
        assertEq(l.recordDates.balanceAt(b, block.timestamp), 0);

        // From the final date's Record Time, the holder of record must stay the account paid.
        address again = makeAddr("investor A, new wallet");
        vm.warp(l.determinations.observation(1).recordTime + 1);
        address idA = address(l.identityRegistry.identity(a));
        vm.expectRevert(GovernanceController.TransfersClosed.selector);
        _via(agentGov, abi.encodeCall(GovernanceController.recoverWallet, (a, again, idA, "Key lost")));
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
        assertEq(l.note.balanceOf(inventory), 25, "tranched up into inventory");
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotOpen.selector, id));
        g.execute(id);
    }

    /// S-24: a queued proposal left unexecuted past its window expires, and nothing more can be done with it.
    function test_queuedProposalExpiresPastItsWindow() public {
        uint256 id = _proposeAmend(agentGov, 5);
        _approve(cosigner, id);
        uint48 readyAt = g.proposal(id).readyAt;
        vm.warp(uint256(readyAt) + WINDOW);
        assertFalse(g.expired(id), "executable to the last second of its window");
        vm.warp(uint256(readyAt) + WINDOW + 1);
        assertTrue(g.expired(id));
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.Expired.selector, id, readyAt + WINDOW));
        g.execute(id);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.Expired.selector, id, readyAt + WINDOW));
        _approve(issuerGov, id);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.Expired.selector, id, readyAt + WINDOW));
        _via(agentGov, abi.encodeCall(GovernanceController.cancel, (id)));
        assertEq(l.note.balanceOf(inventory), 20, "nothing was minted");
        // Proposed afresh, it needs fresh approvals and a fresh delay.
        uint256 again = _proposeAmend(agentGov, 5);
        assertEq(g.proposal(again).readyAt, 0);
    }

    /// An execution window of zero is refused.
    function test_executionWindowMustBeSet() public {
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.InvalidConfiguration.selector, "execution window is zero"));
        new GovernanceController(_config(address(0), 0));
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
        _via(agentGov, abi.encodeCall(GovernanceController.freezeAccount, (b, true, "x")));
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
        assertTrue(l.note.isAgent(address(fresh)));
        assertTrue(_same(l.note.getAgentRestrictions(address(fresh)), g.servicingRestrictions()));
        assertFalse(l.note.isAgent(address(servicing)));
    }

    // --- whose claims the note accepts ---

    /// Trusting a further onboarding agent's claim issuer for the note, and ceasing to trust one,
    /// are Tier 2.
    function test_trustedIssuerIsTier2() public {
        ExpiringClaimIssuer dealer = new ExpiringClaimIssuer(makeAddr("dealer"), 365 days);
        uint256[] memory topics = new uint256[](1);
        topics[0] = ClaimTopics.NOTE_ELIGIBLE;
        uint256 id = abi.decode(
            _via(agentGov, abi.encodeCall(GovernanceController.proposeSetTrustedIssuer, (address(dealer), topics, "Dealer appointed"))),
            (uint256)
        );
        assertEq(g.proposal(id).readyAt, 0, "one institution cannot queue");
        _approve(issuerGov, id);
        vm.warp(block.timestamp + TIER2);
        g.execute(id);
        assertTrue(ITrusted(l.trustedIssuers).hasClaimTopic(address(dealer), ClaimTopics.NOTE_ELIGIBLE));

        // Ceasing to trust the original onboarding agent stops its clients at once.
        id = abi.decode(
            _via(agentGov, abi.encodeCall(GovernanceController.proposeSetTrustedIssuer, (address(d.onboardingIssuer), new uint256[](0), "Mandate ended"))),
            (uint256)
        );
        _approve(cosigner, id);
        vm.warp(block.timestamp + TIER2);
        g.execute(id);
        assertFalse(ITrusted(l.trustedIssuers).isTrustedIssuer(address(d.onboardingIssuer)));
        assertFalse(l.identityRegistry.isVerified(a), "its claims no longer verify");
        vm.expectRevert(GovernanceController.InvalidArgument.selector);
        _via(agentGov, abi.encodeCall(GovernanceController.proposeSetTrustedIssuer, (address(d.onboardingIssuer), new uint256[](0), "again")));
    }

    // --- the worked example: reversal and restatement (ADR 0014) ---

    function test_wrongRecordTimeIsReversedAndRestated() public {
        IDeterminationAgent.Observation memory o = l.determinations.observation(0);
        vm.warp(o.date);
        uint256[] memory lv = new uint256[](3);
        for (uint256 k; k < 3; ++k) lv[k] = initial[k] * 9_000 / 10_000;
        (IDeterminationAgent.Outcome memory out,) = l.determinations.compute(0, lv);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CA_KEY, l.determinations.digest(0, lv, out));
        l.determinations.determine(0, lv, out, abi.encodePacked(r, s, v));

        // Investor A sells to B after the calendar's Record Time, before the true one.
        vm.warp(o.recordTime + 1 hours);
        _send(a, b, 7);
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
        GovernanceController bare = new GovernanceController(_config(address(0), WINDOW));
        vm.prank(address(servicing));
        vm.expectRevert(GovernanceController.NoVenue.selector);
        bare.setVenueSwapping(false);
        vm.prank(address(agentGov));
        vm.expectRevert(GovernanceController.NoVenue.selector);
        bare.withdrawPoolAccess(a, "x");
    }
}
