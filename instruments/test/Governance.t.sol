// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Vm} from "forge-std/Test.sol";
import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {AgentRestrictions, IOwnable2Step, INote} from "../src/interfaces/INote.sol";
import {GovernanceController} from "../src/GovernanceController.sol";
import {CorrectionActs} from "../src/CorrectionActs.sol";
import {DeterminationAgent} from "../src/DeterminationAgent.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {NoteFactory} from "../src/factory/NoteFactory.sol";
import {ClaimTopics} from "../src/claims/ClaimTopics.sol";
import {ExpiringClaimIssuer} from "../src/claims/ExpiringClaimIssuer.sol";
import {Issuance} from "../script/Issuance.sol";
import {Programme} from "../script/Programme.sol";
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

interface IOwned {
    function owner() external view returns (address);
}

/**
 * The programme's governance controller: every note governed from issuance, both tiers,
 * both thresholds, both delays, acts across notes, the programme's roles rotated once for the whole
 * book, determination correction, stewardship of the identity storage, recovery with its veto, the
 * venue, and the deployer's renunciation.
 */
contract GovernanceTest is Stack {
    GovernanceController g;
    Issuance.Issued l2;

    MockVenueChecker checker;
    MockVenueAdapter adapter;
    MockCredentialGate gate;

    address deployer = address(this);
    address a = makeAddr("investor A");
    address b = makeAddr("investor B");

    uint48 constant TIER2 = 1 hours;
    uint48 constant RECOVERY = 4 hours;
    uint48 constant WINDOW = 1 days;

    function setUp() public {
        vm.warp(T0);
        _deployScaffolding();
        checker = new MockVenueChecker(deployer);
        adapter = new MockVenueAdapter(deployer);
        gate = new MockCredentialGate(deployer, address(d.poolRegistry));
        _deployProgramme(Programme.Venue(address(checker), address(adapter), address(gate)));
        g = p.controller;
        initial = [uint256(451_200), 1_820_300, 25_000];
        l = _issueNote("N", _twoDates());
        l2 = _issueNote("M", _twoDates());
        _onboard(inventory, true);
        _onboard(agent, true);
        _onboard(a, true);
        _onboard(b, true);
        _credit(agent, 100_000_000_00);
        vm.startPrank(agent);
        IERC20Like(address(d.deposit)).approve(address(l.payingAgent), type(uint256).max);
        IERC20Like(address(d.deposit)).approve(address(l2.payingAgent), type(uint256).max);
        vm.stopPrank();
        _mintInto(l, 20, 7, 3);
        _mintInto(l2, 10, 0, 4);
        Programme.ceremony(d, p, Programme.Venue(address(checker), address(adapter), address(gate)), deployer);
    }

    // --- helpers ---

    function _mintInto(Issuance.Issued memory n, uint256 inv, uint256 toA, uint256 toB) internal {
        vm.startPrank(address(g));
        n.note.mint(inventory, inv);
        if (toA > 0) n.note.mint(a, toA);
        if (toB > 0) n.note.mint(b, toB);
        n.note.unpause();
        vm.stopPrank();
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

    function _institutions() internal view returns (address[] memory inst) {
        inst = new address[](3);
        (inst[0], inst[1], inst[2]) = (address(agentGov), address(issuerGov), address(cosigner));
    }

    function _config(address checker_, uint48 window) internal view returns (GovernanceController.Config memory) {
        return GovernanceController.Config({
            deposit: address(d.deposit),
            gateway: address(d.gateway),
            sanctions: address(p.sanctions),
            institutions: _institutions(),
            agentGovernance: address(agentGov),
            servicingWallet: address(servicing),
            calculationAgent: vm.addr(CA_KEY),
            funder: agent,
            minInstitutions: 2,
            minSignatures: 4,
            tier2Delay: TIER2,
            recoveryDelay: RECOVERY,
            executionWindow: window,
            checker: checker_,
            adapter: checker_ == address(0) ? address(0) : address(adapter),
            credentialGate: checker_ == address(0) ? address(0) : address(gate)
        });
    }

    function _via(MockWallet w, bytes memory data) internal returns (bytes memory) {
        return w.exec(address(g), data);
    }

    function _proposeAmend(MockWallet w, uint256 units) internal returns (uint256) {
        return abi.decode(
            _via(w, abi.encodeCall(GovernanceController.proposeAmendNotional, (address(l.note), true, units, "Tranche up by agreement"))),
            (uint256)
        );
    }

    function _approve(MockWallet w, uint256 id) internal {
        _via(w, abi.encodeCall(GovernanceController.approve, (id)));
    }

    function _tier2(MockWallet proposer, bytes memory proposal) internal {
        uint256 id = abi.decode(_via(proposer, proposal), (uint256));
        _approve(cosigner == proposer ? issuerGov : cosigner, id);
        vm.warp(block.timestamp + TIER2);
        g.execute(id);
    }

    function _same(AgentRestrictions memory x, AgentRestrictions memory y) internal pure returns (bool) {
        return keccak256(abi.encode(x)) == keccak256(abi.encode(y));
    }

    function _tokens(Issuance.Issued memory x, Issuance.Issued memory y) internal pure returns (address[] memory t) {
        t = new address[](2);
        (t[0], t[1]) = (address(x.note), address(y.note));
    }

    function _levelsAt(uint256 bps) internal view returns (uint256[] memory lv) {
        lv = new uint256[](3);
        for (uint256 k; k < 3; ++k) lv[k] = initial[k] * bps / 10_000;
    }

    function _determineOn(Issuance.Issued memory n, uint256 k, uint256 bps, uint256 key) internal {
        uint256[] memory lv = _levelsAt(bps);
        (IDeterminationAgent.Outcome memory out,) = n.determinations.compute(k, lv);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, n.determinations.digest(k, lv, out));
        n.determinations.determine(k, lv, out, abi.encodePacked(r, s, v));
    }

    // --- configuration and binding ---

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
        c.funder = address(0);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.InvalidConfiguration.selector, "a programme role is unset"));
        new GovernanceController(c);
        c.funder = agent;
        c.checker = address(checker);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.InvalidConfiguration.selector, "venue incomplete"));
        new GovernanceController(c);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.InvalidConfiguration.selector, "execution window is zero"));
        new GovernanceController(_config(address(0), 0));
    }

    /// The controller binds one factory, the one that names it, and adopts notes from it alone.
    function test_onlyItsFactoryHandsItNotes() public {
        vm.expectRevert(GovernanceController.InvalidArgument.selector);
        g.bindFactory(address(p.factory));
        GovernanceController.IssuedNote memory n;
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotFactory.selector, address(this)));
        g.adopt(n);
        assertTrue(g.isGoverned(address(l.note)) && g.isGoverned(address(l2.note)));
        address[] memory all = g.notes();
        assertEq(all.length, 2);
        assertEq(all[1], address(l2.note));
    }

    // --- the ceremony, and every note governed from issuance ---

    /// The deployer and the Issuer hold nothing on any note, the deposit or the gateway once the
    /// ceremony ends; the Issuer's inventory is a holder like any other.
    function test_theDeployerAndTheIssuerHoldNothing() public view {
        address[3] memory gone = [deployer, agent, inventory];
        Issuance.Issued[2] memory both = [l, l2];
        for (uint256 n; n < 2; ++n) {
            address[5] memory owned =
                [address(both[n].note), address(both[n].identityRegistry), both[n].trustedIssuers, both[n].claimTopics, both[n].compliance];
            for (uint256 i; i < gone.length; ++i) {
                assertFalse(both[n].note.isAgent(gone[i]), "note agent");
                for (uint256 k; k < owned.length; ++k) assertTrue(IOwnable2Step(owned[k]).owner() != gone[i], "owner");
            }
        }
        for (uint256 i; i < gone.length; ++i) {
            assertFalse(IRoles(address(d.deposit)).hasRole(0x00, gone[i]), "deposit admin");
            assertFalse(IRoles(address(d.gateway)).hasRole(0x00, gone[i]), "gateway admin");
        }
        assertFalse(INote(address(l.identityRegistry)).isAgent(onboardingAgent), "notes' registries are written by no institution");
    }

    function test_everyNoteIsGovernedFromIssuance() public view {
        Issuance.Issued[2] memory both = [l, l2];
        for (uint256 n; n < 2; ++n) {
            Issuance.Issued memory x = both[n];
            address[5] memory owned = [address(x.note), address(x.identityRegistry), x.trustedIssuers, x.claimTopics, x.compliance];
            for (uint256 k; k < owned.length; ++k) assertEq(IOwnable2Step(owned[k]).owner(), address(g), "the controller owns the suite");
            assertTrue(_same(x.note.getAgentRestrictions(address(g)), Issuance.controllerRestrictions()), "controller restricted");
            assertTrue(_same(x.note.getAgentRestrictions(address(x.payingAgent)), Issuance.payingAgentRestrictions()));
            assertTrue(_same(x.note.getAgentRestrictions(address(x.settlement)), Issuance.settlementRestrictions()));
            assertFalse(x.note.isAgent(address(servicing)), "the servicing wallet acts through the controller");
            assertTrue(IRoles(address(d.deposit)).hasRole(d.deposit.FORCED_TRANSFER_ROLE(), address(x.payingAgent)));
            assertTrue(d.deposit.allowlisted(address(x.payingAgent)) && d.deposit.allowlisted(address(x.settlement)));
            assertEq(address(x.payingAgent.roles()), address(g), "its roles are the programme's");
        }
        assertEq(IOwned(address(d.trexFactory)).owner(), address(p.factory), "the note factory owns T-REX's factory");
        assertEq(p.factory.owner(), address(issuerGov), "the Issuer's wallet owns the note factory");
    }

    /// Each note's logic is fixed: its proxies answer to an authority that can switch nothing.
    function test_noteLogicIsFixed() public {
        address authority = IProxyAuthority(address(l.note)).getImplementationAuthority();
        assertEq(authority, address(d.trexAuthority));
        vm.prank(address(g));
        vm.expectRevert();
        IProxyAuthority(address(l.note)).setImplementationAuthority(address(1));
    }

    // --- Tier 1 ---

    function test_tier1IsTheAgentGovernanceWalletAlone() public {
        string memory reason = "Register correction: units delivered to investor B's old address";
        vm.recordLogs();
        _via(agentGov, abi.encodeCall(GovernanceController.correctRegister, (address(l.note), a, b, 2, reason)));
        assertEq(l.note.balanceOf(b), 5);
        bool found;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 k; k < logs.length; ++k) {
            if (logs[k].topics[0] == keccak256("Tier1(address,string,string)")) {
                (, string memory r) = abi.decode(logs[k].data, (string, string));
                found = keccak256(bytes(r)) == keccak256(bytes(reason)) && logs[k].topics[1] == bytes32(uint256(uint160(address(l.note))));
            }
        }
        assertTrue(found, "reason emitted in full, with the note it concerns");

        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotAgentGovernance.selector, address(issuerGov)));
        _via(issuerGov, abi.encodeCall(GovernanceController.correctRegister, (address(l.note), a, b, 1, reason)));
        vm.expectRevert(GovernanceController.NoReason.selector);
        _via(agentGov, abi.encodeCall(GovernanceController.correctRegister, (address(l.note), a, b, 1, "")));
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotGoverned.selector, address(d.deposit)));
        _via(agentGov, abi.encodeCall(GovernanceController.correctRegister, (address(d.deposit), a, b, 1, reason)));
    }

    /// The supervisory stop, on every note named, in one act.
    function test_tier1FreezesAnAccountAcrossNotes() public {
        _via(agentGov, abi.encodeCall(GovernanceController.freezeAccount, (_tokens(l, l2), b, true, "Supervisory stop")));
        assertTrue(l.note.isFrozen(b) && l2.note.isFrozen(b));
        vm.prank(b);
        vm.expectRevert();
        IERC20Like(address(l2.note)).transfer(a, 1);
        _via(agentGov, abi.encodeCall(GovernanceController.freezeAccount, (_tokens(l, l2), b, false, "Lifted")));
        assertFalse(l.note.isFrozen(b) || l2.note.isFrozen(b));
    }

    /// A sanctions designation stops an account on every note at once, issued before or after.
    function test_tier1DesignatesAcrossTheProgramme() public {
        _via(agentGov, abi.encodeCall(GovernanceController.designate, (b, true, "Sanctions designation")));
        vm.prank(b);
        vm.expectRevert();
        IERC20Like(address(l.note)).transfer(a, 1);
        vm.prank(a);
        vm.expectRevert();
        IERC20Like(address(l2.note)).transfer(b, 1);
        Issuance.Issued memory later = _issueNote("L", _twoDates());
        _mintInto(later, 5, 2, 0);
        vm.prank(a);
        vm.expectRevert();
        IERC20Like(address(later.note)).transfer(b, 1);
        _via(agentGov, abi.encodeCall(GovernanceController.designate, (b, false, "Designation lifted")));
        vm.prank(b);
        IERC20Like(address(l.note)).transfer(a, 1);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotAgentGovernance.selector, address(cosigner)));
        _via(cosigner, abi.encodeCall(GovernanceController.designate, (b, true, "x")));
    }

    /// S-25 across notes: the identity moves once, every note's units follow, and each note's record
    /// dates keep in step; never on a note while its transfers are stopped.
    function test_tier1RecoversALostWalletAcrossNotes() public {
        address replacement = makeAddr("investor B, new wallet");
        address id = address(l.identityRegistry.identity(b));
        _via(agentGov, abi.encodeCall(GovernanceController.recoverWallet, (_tokens(l, l2), b, replacement, id, "Key lost")));
        assertEq(l.note.balanceOf(replacement), 3);
        assertEq(l2.note.balanceOf(replacement), 4);
        assertEq(l.note.balanceOf(b) + l2.note.balanceOf(b), 0);
        assertEq(address(l.identityRegistry.identity(replacement)), id, "the identity moves with the units");
        assertFalse(l2.identityRegistry.contains(b), "the lost wallet is removed, for every note");
        assertEq(l2.recordDates.balanceAt(replacement, block.timestamp), 4, "the record dates follow");

        address again = makeAddr("investor A, new wallet");
        vm.warp(l.determinations.observation(1).recordTime + 1);
        address idA = address(l.identityRegistry.identity(a));
        vm.expectRevert(GovernanceController.TransfersClosed.selector);
        _via(agentGov, abi.encodeCall(GovernanceController.recoverWallet, (_tokens(l, l2), a, again, idA, "Key lost")));
    }

    /// S-14: units cancelled from the inventory, never more than it holds unoffered.
    function test_tier1CancelsInventory() public {
        _via(agentGov, abi.encodeCall(GovernanceController.cancelInventory, (address(l.note), 5, "Tranche reduced")));
        assertEq(l.note.balanceOf(inventory), 15);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.InventoryUnavailable.selector, 16, 15));
        _via(agentGov, abi.encodeCall(GovernanceController.cancelInventory, (address(l.note), 16, "Too many")));
    }

    /// The servicing wallet pauses a note through the controller, and no one else does.
    function test_servicingPausesANote() public {
        _via(servicing, abi.encodeCall(GovernanceController.setNotePaused, (address(l2.note), true)));
        assertTrue(l2.note.paused());
        assertFalse(l.note.paused(), "the other note is untouched");
        _via(servicing, abi.encodeCall(GovernanceController.setNotePaused, (address(l2.note), false)));
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotServicingWallet.selector, address(agentGov)));
        _via(agentGov, abi.encodeCall(GovernanceController.setNotePaused, (address(l.note), true)));
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
        assertEq(l2.note.balanceOf(inventory), 10, "the other note is untouched");
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotOpen.selector, id));
        g.execute(id);
    }

    /// S-24: a queued proposal left unexecuted past its window expires.
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
        assertEq(l.note.balanceOf(inventory), 20, "nothing was minted");
        uint256 again = _proposeAmend(agentGov, 5);
        assertEq(g.proposal(again).readyAt, 0, "proposed afresh, it needs fresh approvals");
    }

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
        servicing.exec(address(g), abi.encodeCall(GovernanceController.proposeAmendNotional, (address(l.note), true, 1, "x")));
    }

    // --- recovery of an institution ---

    function test_recoveryNeedsEveryOtherInstitutionAndTheLongerDelay() public {
        MockWallet replacement = new MockWallet(2);
        uint256 id = abi.decode(
            _via(issuerGov, abi.encodeCall(GovernanceController.proposeReplaceInstitution, (address(agentGov), address(replacement), "Agent wallet lost"))),
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
        _via(agentGov, abi.encodeCall(GovernanceController.freezeAccount, (_tokens(l, l2), b, true, "x")));
    }

    function test_theOldWalletVetoesRecovery() public {
        MockWallet replacement = new MockWallet(2);
        uint256 id = abi.decode(
            _via(issuerGov, abi.encodeCall(GovernanceController.proposeReplaceInstitution, (address(cosigner), address(replacement), "Co-signer lost"))),
            (uint256)
        );
        _approve(agentGov, id);
        _via(cosigner, abi.encodeCall(GovernanceController.cancel, (id)));
        vm.warp(block.timestamp + RECOVERY);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotOpen.selector, id));
        g.execute(id);
    }

    // --- the programme's roles, rotated once for the whole book ---

    function test_servicingWalletRotatesForEveryNote() public {
        MockWallet fresh = new MockWallet(2);
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeReplaceRole, (GovernanceController.Kind.ReplaceServicingWallet, address(fresh), "Rotation")));
        assertEq(g.servicingWallet(), address(fresh));
        vm.warp(l.determinations.observation(0).date);
        _determineOn(l, 0, 9_000, CA_KEY);
        _determineOn(l2, 0, 9_000, CA_KEY);
        vm.warp(l.determinations.observation(0).paymentDate);
        vm.prank(address(servicing));
        vm.expectRevert(abi.encodeWithSelector(PayingAgent.NotServicingWallet.selector, address(servicing)));
        l2.payingAgent.open(0, PayingAgent.Kind.Coupon);
        vm.prank(address(fresh));
        l.payingAgent.open(0, PayingAgent.Kind.Coupon);
        vm.prank(address(fresh));
        l2.payingAgent.open(0, PayingAgent.Kind.Coupon);
    }

    function test_calculationAgentRotatesForEveryNote() public {
        uint256 freshKey = 0xC0FFEE;
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeReplaceRole, (GovernanceController.Kind.ReplaceCalculationAgent, vm.addr(freshKey), "New Calculation Agent")));
        vm.warp(l.determinations.observation(0).date);
        uint256[] memory lv = _levelsAt(9_000);
        (IDeterminationAgent.Outcome memory out,) = l2.determinations.compute(0, lv);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CA_KEY, l2.determinations.digest(0, lv, out));
        vm.expectRevert(IDeterminationAgent.BadSignature.selector);
        l2.determinations.determine(0, lv, out, abi.encodePacked(r, s, v));
        _determineOn(l, 0, 9_000, freshKey);
        _determineOn(l2, 0, 9_000, freshKey);
    }

    function test_funderRotates() public {
        address treasury = makeAddr("new funding account");
        _onboard(treasury, false);
        _credit(treasury, 10_000_000_00);
        vm.prank(treasury);
        IERC20Like(address(d.deposit)).approve(address(l.payingAgent), type(uint256).max);
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeReplaceRole, (GovernanceController.Kind.ReplaceFunder, treasury, "Funding moved")));
        vm.warp(l.determinations.observation(0).date);
        _determineOn(l, 0, 9_000, CA_KEY);
        vm.warp(l.determinations.observation(0).paymentDate);
        uint256 before = d.deposit.balanceOf(treasury);
        vm.prank(address(servicing));
        l.payingAgent.open(0, PayingAgent.Kind.Coupon);
        assertEq(before - d.deposit.balanceOf(treasury), 10 * 2_500, "drawn from the new funder");
    }

    function test_onlyRolesRotate() public {
        vm.expectRevert(GovernanceController.InvalidArgument.selector);
        _via(agentGov, abi.encodeCall(GovernanceController.proposeReplaceRole, (GovernanceController.Kind.AmendNotional, a, "x")));
        vm.expectRevert(GovernanceController.InvalidArgument.selector);
        _via(agentGov, abi.encodeCall(GovernanceController.proposeReplaceRole, (GovernanceController.Kind.ReplaceFunder, address(issuerGov), "x")));
    }

    // --- the deposit's and gateway's roles ---

    function test_depositRolesAreTier2() public {
        address desk = makeAddr("second payments desk");
        bytes32 pauser = d.deposit.PAUSER_ROLE();
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeSetDepositRole, (address(d.deposit), pauser, desk, true, "Second desk")));
        assertTrue(IRoles(address(d.deposit)).hasRole(pauser, desk));
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeSetDepositRole, (address(d.deposit), pauser, desk, false, "Desk closed")));
        assertFalse(IRoles(address(d.deposit)).hasRole(pauser, desk));
        vm.expectRevert(GovernanceController.InvalidArgument.selector);
        _via(agentGov, abi.encodeCall(GovernanceController.proposeSetDepositRole, (address(l.note), pauser, desk, true, "x")));
    }

    // --- whose claims a note accepts ---

    function test_trustedIssuerIsTier2AndPerNote() public {
        ExpiringClaimIssuer dealer = new ExpiringClaimIssuer(makeAddr("dealer"), 365 days);
        uint256[] memory topics = new uint256[](1);
        topics[0] = ClaimTopics.NOTE_ELIGIBLE;
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeSetTrustedIssuer, (address(l.note), address(dealer), topics, "Dealer appointed")));
        assertTrue(ITrusted(l.trustedIssuers).hasClaimTopic(address(dealer), ClaimTopics.NOTE_ELIGIBLE));
        assertFalse(ITrusted(l2.trustedIssuers).isTrustedIssuer(address(dealer)), "the other note is untouched");

        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeSetTrustedIssuer, (address(l.note), address(d.onboardingIssuer), new uint256[](0), "Mandate ended")));
        assertFalse(l.identityRegistry.isVerified(a), "its claims no longer verify on that note");
        assertTrue(l2.identityRegistry.isVerified(a), "and still do on the other");
    }

    // --- reversal and restatement ---

    function test_wrongRecordTimeIsReversedAndRestated() public {
        IDeterminationAgent.Observation memory o = l.determinations.observation(0);
        vm.warp(o.date);
        _determineOn(l, 0, 9_000, CA_KEY);
        vm.warp(o.recordTime + 1 hours);
        _send(a, b, 7);
        uint48 trueRecordTime = o.recordTime + 1 days;

        vm.warp(o.paymentDate);
        address[] memory both = new address[](2);
        (both[0], both[1]) = (a, b);
        bytes32 id = _openDistribution(0, PayingAgent.Kind.Coupon);
        _payHolders(id, both);
        assertEq(d.deposit.balanceOf(a), 7 * 2_500, "A was paid on the wrong Record Time");

        string memory reason = "Coupon 1 paid on the 23rd; the terms fix the 25th";
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeReverseDistribution, (address(l.note), id, both, reason)));
        assertEq(d.deposit.balanceOf(a), 0, "reversed against the original credit");
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeRestateDistribution, (address(l.note), id, trueRecordTime, reason)));
        bytes32 restated = keccak256(abi.encode(id, trueRecordTime));
        address[] memory onlyB = new address[](1);
        onlyB[0] = b;
        _payHolders(restated, onlyB);
        assertEq(d.deposit.balanceOf(b), 10 * 2_500, "B, the holder at the true Record Time, is paid for all ten");
    }

    // --- correcting a determination ---

    function _correction(Issuance.Issued memory n, uint256 dateIndex, uint256 bps, address[] memory holders)
        internal
        view
        returns (CorrectionActs.Correction memory c)
    {
        uint256[] memory lv = _levelsAt(bps);
        c.token = address(n.note);
        c.dateIndex = dateIndex;
        c.levels = lv;
        // Recomputed as the contract will: from the state before the date, as it also reports.
        c.outcome = IDeterminationAgent.Outcome(false, bps >= 7_000, bps >= 7_000 ? 2_500 : 0, false, 0, 0);
        assertEq(abi.encode(DeterminationAgent(address(n.determinations)).computeCorrection(dateIndex, lv)), abi.encode(c.outcome), "the correction as computed");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CA_KEY, n.determinations.digest(dateIndex, lv, c.outcome));
        c.signature = abi.encodePacked(r, s, v);
        c.holders = holders;
    }

    /// Wrong Levels that missed a coupon are corrected before anything is paid; the coupon then
    /// opens in the ordinary way.
    function test_aDeterminationIsCorrectedBeforePayment() public {
        vm.warp(l.determinations.observation(0).date);
        _determineOn(l, 0, 6_500, CA_KEY);
        assertFalse(l.determinations.outcomeOf(0).couponPaid, "wrongly missed");
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeCorrectDetermination, (_correction(l, 0, 9_000, new address[](0)), "Levels misread")));
        assertTrue(l.determinations.outcomeOf(0).couponPaid, "corrected");
        assertEq(l.determinations.missedCoupons(), 0);
        vm.warp(l.determinations.observation(0).paymentDate);
        _openDistribution(0, PayingAgent.Kind.Coupon);
    }

    /// A coupon paid on wrong Levels is corrected away: the same act reverses it, holder by holder.
    function test_aPaidCouponIsCorrectedAndReversed() public {
        IDeterminationAgent.Observation memory o = l.determinations.observation(0);
        vm.warp(o.date);
        _determineOn(l, 0, 9_000, CA_KEY);
        vm.warp(o.paymentDate);
        address[] memory both = new address[](2);
        (both[0], both[1]) = (a, b);
        bytes32 id = _openDistribution(0, PayingAgent.Kind.Coupon);
        _payHolders(id, both);
        assertEq(d.deposit.balanceOf(a), 7 * 2_500);

        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeCorrectDetermination, (_correction(l, 0, 6_500, both), "Worst performer was below the coupon barrier")));
        assertFalse(l.determinations.outcomeOf(0).couponPaid);
        assertEq(d.deposit.balanceOf(a), 0, "reversed");
        (,,,,,,, bool reversed,,) = l.payingAgent.distributions(id);
        assertTrue(reversed);
    }

    function test_aCorrectionIsRefusedWhileACouponIsBeingPaid() public {
        IDeterminationAgent.Observation memory o = l.determinations.observation(0);
        vm.warp(o.date);
        _determineOn(l, 0, 9_000, CA_KEY);
        vm.warp(o.paymentDate);
        _openDistribution(0, PayingAgent.Kind.Coupon);
        uint256 id = abi.decode(
            _via(agentGov, abi.encodeCall(GovernanceController.proposeCorrectDetermination, (_correction(l, 0, 6_500, new address[](0)), "x"))),
            (uint256)
        );
        _approve(cosigner, id);
        vm.warp(block.timestamp + TIER2);
        vm.expectRevert(abi.encodeWithSelector(CorrectionActs.CouponNotClosed.selector, address(l.note), 0));
        g.execute(id);
    }

    function test_onlyTheControllerCorrects() public {
        vm.warp(l.determinations.observation(0).date);
        _determineOn(l, 0, 6_500, CA_KEY);
        CorrectionActs.Correction memory c = _correction(l, 0, 9_000, new address[](0));
        vm.expectRevert(abi.encodeWithSelector(DeterminationAgent.NotGovernance.selector, address(this)));
        l.determinations.correct(0, c.levels, c.outcome, c.signature);
    }

    // --- stewardship of the identity storage ---

    function test_onlyARedeemedNoteIsRetired() public {
        uint256 id = abi.decode(_via(agentGov, abi.encodeCall(GovernanceController.proposeRetireNote, (address(l.note), "Matured"))), (uint256));
        _approve(cosigner, id);
        vm.warp(block.timestamp + TIER2);
        vm.expectRevert(abi.encodeWithSelector(NoteFactory.NotRedeemed.selector, address(l.note)));
        g.execute(id);
    }

    function test_theStorageIsHandedToASuccessorFactory() public {
        address successor = makeAddr("successor factory");
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeReleaseFactory, (successor, "New payoff family")));
        assertEq(IOwned(address(d.trexFactory)).owner(), successor);
    }

    // --- the venue ---

    function test_ceremonyHandsOverTheVenue() public view {
        assertEq(checker.owner(), address(g), "checker");
        assertEq(adapter.owner(), address(g), "adapter");
        assertTrue(gate.hasRole(0x00, address(g)), "gate admin");
        assertTrue(gate.hasRole(gate.SUPERVISOR_ROLE(), address(g)), "gate supervisor");
        assertFalse(gate.hasRole(0x00, deployer), "the deployer renounced the gate");
        assertEq(d.poolRegistry.owner(), address(g), "pool registry");
        assertEq(d.poolTopics.owner(), address(g), "pool topics");
        assertEq(d.poolIssuers.owner(), address(g), "pool trusted issuers");
    }

    function test_servicingSwitchesSwapping() public {
        _via(servicing, abi.encodeCall(GovernanceController.setVenueSwapping, (false)));
        assertFalse(adapter.swappingEnabled(), "off at once");
        _via(servicing, abi.encodeCall(GovernanceController.setVenueSwapping, (true)));
        assertTrue(adapter.swappingEnabled(), "and back on");
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotServicingWallet.selector, address(agentGov)));
        _via(agentGov, abi.encodeCall(GovernanceController.setVenueSwapping, (false)));
    }

    function test_tier1WithdrawsPoolAccess() public {
        string memory reason = "Adverse media match under review; pool access suspended pending the outcome";
        _via(agentGov, abi.encodeCall(GovernanceController.withdrawPoolAccess, (b, reason)));
        assertEq(gate.withdrawnFor(b), reason);
        vm.expectRevert(abi.encodeWithSelector(GovernanceController.NotAgentGovernance.selector, address(cosigner)));
        _via(cosigner, abi.encodeCall(GovernanceController.withdrawPoolAccess, (b, reason)));
        _via(agentGov, abi.encodeCall(GovernanceController.restorePoolAccess, (b, "Review closed with no finding")));
        assertEq(gate.restoredFor(b), "Review closed with no finding");
    }

    function test_repointingTheCredentialGateIsTier2() public {
        MockCredentialGate next = new MockCredentialGate(address(g), address(d.poolRegistry));
        bytes32 supervisor = next.SUPERVISOR_ROLE();
        vm.prank(address(g));
        next.grantRole(supervisor, address(g));
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeSetCredentialGate, (address(next), "New policy")));
        assertEq(checker.credentialGate(address(d.deposit)), address(next), "the checker reads the new gate");
        assertEq(g.credentialGate(), address(next));
        _via(agentGov, abi.encodeCall(GovernanceController.withdrawPoolAccess, (a, "Withdrawn on the new gate")));
        assertEq(next.withdrawnFor(a), "Withdrawn on the new gate");
    }

    function test_liquidityProvidersRoutersHooksAndPoolIssuersAreTier2() public {
        address lp = makeAddr("second liquidity provider");
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeSetLiquidityProvider, (lp, true, "Second provider")));
        assertTrue(checker.liquidityApproved(address(d.deposit), lp));
        address router = makeAddr("router");
        _tier2(issuerGov, abi.encodeCall(GovernanceController.proposeSetVenueWrapper, (router, true, "Router allowed")));
        assertTrue(adapter.allowedWrappers(router));
        address hook = makeAddr("hook");
        _tier2(issuerGov, abi.encodeCall(GovernanceController.proposeSetVenueHook, (hook, true, "Hook allowed")));
        assertTrue(adapter.allowedHooks(hook));
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeSetPoolIssuer, (address(d.onboardingIssuer), true, "The onboarding agent admits too")));
        assertTrue(d.poolIssuers.hasClaimTopic(address(d.onboardingIssuer), ClaimTopics.POOL_ACCESS));
        _tier2(agentGov, abi.encodeCall(GovernanceController.proposeSetPoolIssuer, (address(d.bankIssuer), false, "Mandate ended")));
        assertFalse(d.poolIssuers.isTrustedIssuer(address(d.bankIssuer)));
    }

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
