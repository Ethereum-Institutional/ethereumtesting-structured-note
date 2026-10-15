// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IIdentity} from "@onchain-id/solidity/contracts/interface/IIdentity.sol";
import {ITREXFactory} from "t-rex/factory/ITREXFactory.sol";
import {AgentRestrictions, IOwnable2Step, INote} from "../src/interfaces/INote.sol";
import {NoteFactory} from "../src/factory/NoteFactory.sol";
import {AgentPowers} from "../src/factory/AgentPowers.sol";
import {ClaimTopics} from "../src/claims/ClaimTopics.sol";
import {Issuance} from "../script/Issuance.sol";
import {Stack} from "./Stack.sol";

/**
 * The note factory (ADR 0091): a note issued whole in one transaction, owned by the factory for the
 * Issuer, administered only through it and only on its own contracts, handed over in one call, and
 * recorded.
 */
contract NoteFactoryTest is Stack {
    address servicing = makeAddr("Agent servicing wallet");
    address canceller = makeAddr("Agent, cancelling inventory");
    NoteFactory f;

    function setUp() public {
        _deployStack();
        f = d.noteFactory;
    }

    function _params(string memory salt, uint256 units, bool open) internal view returns (NoteFactory.Params memory p) {
        p.salt = salt;
        p.name = "Series 2";
        p.symbol = "S2";
        p.terms = _terms();
        p.issuer = inventory;
        p.calculationAgent = vm.addr(CA_KEY);
        p.funder = agent;
        p.payer = servicing;
        p.termSheetHash = keccak256("term sheet 2");
        p.termSheetUri = "ipfs://term-sheet-2";
        p.units = units;
        p.open = open;
        p.agents = new NoteFactory.AgentGrant[](1);
        p.agents[0] = NoteFactory.AgentGrant(canceller, AgentPowers.burnOnly());
    }

    function _same(AgentRestrictions memory x, AgentRestrictions memory y) internal pure returns (bool) {
        return keccak256(abi.encode(x)) == keccak256(abi.encode(y));
    }

    // --- one transaction ---

    /// The whole note in one call: its contracts, the notional in the inventory, open, each agent
    /// with its own powers, and the factory no agent at all.
    function test_issuesAWholeNoteInOneTransaction() public {
        NoteFactory.Note memory n = f.issue(_params("series-2", 50, true));
        INote note = INote(n.token);
        assertEq(note.balanceOf(inventory), 50, "the notional is in the inventory");
        assertFalse(note.paused(), "open for transfers");
        assertFalse(note.isAgent(address(f)), "the factory keeps no agent power");
        assertTrue(_same(note.getAgentRestrictions(inventory), AgentPowers.issuer()), "the Issuer mints and pauses");
        assertTrue(_same(note.getAgentRestrictions(n.payingAgent), AgentPowers.payingAgent()), "the Paying Agent");
        assertTrue(_same(note.getAgentRestrictions(n.settlement), AgentPowers.settlement()), "the settlement contract");
        assertTrue(_same(note.getAgentRestrictions(canceller), AgentPowers.burnOnly()), "an agent named at issuance");
        assertEq(note.identityRegistry(), n.identityRegistry);
        assertEq(note.compliance(), n.compliance);
        assertEq(address(Issuance.issued(n).recordDates.DETERMINATIONS()), n.determinations, "the record dates read the terms");
        assertEq(address(Issuance.issued(n).payingAgent.NOTE()), n.token, "the Paying Agent services this note");
        assertEq(Issuance.issued(n).payingAgent.INVENTORY(), inventory);
    }

    /// The note's registry requires the onboarding agent's note claim, as every note's does.
    function test_theNoteRequiresTheNoteClaim() public {
        NoteFactory.Note memory n = f.issue(_params("series-2", 0, false));
        _onboard(makeAddr("cash only"), false);
        _onboard(makeAddr("note holder"), true);
        assertFalse(Issuance.issued(n).identityRegistry.isVerified(makeAddr("cash only")));
        assertTrue(Issuance.issued(n).identityRegistry.isVerified(makeAddr("note holder")));
    }

    /// The term sheet is stated on the note's own identity, which the factory manages.
    function test_theTermSheetIsOnTheNotesIdentity() public {
        NoteFactory.Note memory n = f.issue(_params("series-2", 0, false));
        IIdentity id = IIdentity(n.identity);
        (uint256 topic,,,, bytes memory data,) = id.getClaim(keccak256(abi.encode(n.identity, ClaimTopics.TERM_SHEET)));
        assertEq(topic, ClaimTopics.TERM_SHEET);
        (bytes32 hash,) = abi.decode(data, (bytes32, string));
        assertEq(hash, keccak256("term sheet 2"));
        assertTrue(id.keyHasPurpose(keccak256(abi.encode(address(f))), 1), "the factory manages the identity");
    }

    /// The notional is minted only to an inventory the note's registry accepts.
    function test_mintingNeedsAnEligibleInventory() public {
        NoteFactory.Params memory p = _params("series-2", 10, true);
        p.issuer = makeAddr("not onboarded");
        vm.expectRevert();
        f.issue(p);
    }

    // --- the Issuer alone ---

    function test_onlyTheIssuerIssues() public {
        NoteFactory.Params memory p = _params("series-2", 0, false);
        vm.prank(makeAddr("anyone"));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, makeAddr("anyone")));
        f.issue(p);
    }

    /// T-REX's factory belongs to the note factory, so no note is issued around it.
    function test_noNoteIsIssuedAroundTheFactory() public {
        assertEq(Ownable(address(d.trexFactory)).owner(), address(f));
        ITREXFactory.TokenDetails memory t;
        ITREXFactory.ClaimDetails memory c;
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        d.trexFactory.deployTREXSuite("around", t, c);
    }

    function test_aSaltIsUsedOnce() public {
        f.issue(_params("series-2", 0, false));
        NoteFactory.Params memory p = _params("series-2", 0, false);
        vm.expectRevert();
        f.issue(p);
    }

    function test_rolesMustBeNamed() public {
        NoteFactory.Params memory p = _params("series-2", 0, false);
        p.payer = address(0);
        vm.expectRevert(NoteFactory.InvalidArgument.selector);
        f.issue(p);
    }

    // --- administration, and the hand-over ---

    /// The Issuer acts as the note's owner through the factory, on the note's own contracts only.
    function test_administerReachesTheNotesOwnContractsOnly() public {
        NoteFactory.Note memory n = f.issue(_params("series-2", 0, false));
        address extra = makeAddr("extra agent");
        f.administer(n.token, n.token, abi.encodeCall(INote.addAgent, (extra)));
        assertTrue(INote(n.token).isAgent(extra));

        vm.expectRevert(abi.encodeWithSelector(NoteFactory.NotPartOfNote.selector, address(d.deposit)));
        f.administer(n.token, address(d.deposit), abi.encodeWithSignature("pause()"));
        vm.expectRevert(abi.encodeWithSelector(NoteFactory.NotPartOfNote.selector, address(l.note)));
        f.administer(n.token, address(l.note), abi.encodeCall(INote.addAgent, (extra)));

        // A refusal comes back whole.
        vm.expectRevert();
        f.administer(n.token, n.token, abi.encodeCall(INote.addAgent, (extra)));

        vm.prank(makeAddr("anyone"));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, makeAddr("anyone")));
        f.administer(n.token, n.token, abi.encodeCall(INote.removeAgent, (extra)));
    }

    /// One call offers every contract to the new owner and moves the identity's management; the
    /// factory then holds nothing of the note.
    function test_handOverOffersEverythingOnce() public {
        NoteFactory.Note memory n = f.issue(_params("series-2", 0, false));
        address next = makeAddr("next owner");
        f.handOver(n.token, next);

        address[5] memory owned = [n.token, n.identityRegistry, n.trustedIssuers, n.claimTopics, n.compliance];
        for (uint256 k = 0; k < owned.length; ++k) {
            assertEq(IOwnable2Step(owned[k]).pendingOwner(), next, "offered");
            vm.prank(next);
            IOwnable2Step(owned[k]).acceptOwnership();
            assertEq(IOwnable2Step(owned[k]).owner(), next, "accepted");
        }
        IIdentity id = IIdentity(n.identity);
        assertTrue(id.keyHasPurpose(keccak256(abi.encode(next)), 1), "the new owner manages the identity");
        assertFalse(id.keyHasPurpose(keccak256(abi.encode(address(f))), 1), "the factory does not");
        assertFalse(f.holds(n.token));

        vm.expectRevert(abi.encodeWithSelector(NoteFactory.NotHeld.selector, n.token));
        f.administer(n.token, n.token, abi.encodeCall(INote.addAgent, (next)));
        vm.expectRevert(abi.encodeWithSelector(NoteFactory.NotHeld.selector, n.token));
        f.handOver(n.token, next);
    }

    // --- the record ---

    function test_everyNoteIsRecorded() public {
        uint256 before = f.noteCount();
        vm.recordLogs();
        NoteFactory.Note memory n = f.issue(_params("series-2", 0, false));
        assertEq(f.noteCount(), before + 1);
        assertEq(f.notes()[before], n.token);
        assertEq(f.noteOf(n.token).payingAgent, n.payingAgent);
        assertTrue(f.holds(n.token));
    }

    // --- the bank's one call ---

    function test_theBankAllowlistsTheLifecycleInOneCall() public {
        NoteFactory.Note memory n = f.issue(_params("series-2", 0, false));
        address[] memory accounts = new address[](2);
        (accounts[0], accounts[1]) = (n.payingAgent, n.settlement);
        bytes32 role = d.deposit.ALLOWLIST_ROLE();
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), role));
        d.deposit.setAllowlistedMany(accounts, true);
        vm.prank(bank);
        d.deposit.setAllowlistedMany(accounts, true);
        assertTrue(d.deposit.allowlisted(n.payingAgent) && d.deposit.allowlisted(n.settlement));
    }
}
