// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IIdentity} from "@onchain-id/solidity/contracts/interface/IIdentity.sol";
import {ITREXFactory} from "t-rex/factory/ITREXFactory.sol";
import {IOwnable2Step, INote} from "../src/interfaces/INote.sol";
import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {IProgrammeRoles} from "../src/interfaces/IProgrammeRoles.sol";
import {NoteFactory} from "../src/factory/NoteFactory.sol";
import {DeterminationAgent} from "../src/DeterminationAgent.sol";
import {PayingAgent, INoteServicing, ICashLeg, IRecordDates} from "../src/PayingAgent.sol";
import {ClaimTopics} from "../src/claims/ClaimTopics.sol";
import {ExpiringClaimIssuer} from "../src/claims/ExpiringClaimIssuer.sol";
import {Issuance} from "../script/Issuance.sol";
import {Onboarding} from "../script/Onboarding.sol";
import {Stack} from "./Stack.sol";

/**
 * The note factory: each note issued whole in one transaction by the Issuer's wallet,
 * with its series identity and its own lifecycle clones, allowlisted on the deposit and governed by
 * the controller from the first block; several in one call; and every note recorded.
 */
contract NoteFactoryTest is Stack {
    NoteFactory f;

    function setUp() public {
        _deployStack();
        f = p.factory;
    }

    function _params(string memory symbol, uint256 units, bool open) internal view returns (NoteFactory.Params memory q) {
        q = Issuance.params(
            _terms(),
            Issuance.Config({
                issuer: inventory,
                isin: "",
                name: symbol,
                symbol: symbol,
                termSheetHash: keccak256(bytes(symbol)),
                termSheetUri: "ipfs://term-sheet",
                units: units,
                open: open
            })
        );
    }

    function _issue(NoteFactory.Params memory q) internal returns (NoteFactory.Note memory) {
        vm.prank(address(issuerGov));
        return f.issue(q);
    }

    // --- one transaction ---

    /// The whole note in one call: the notional in the inventory, open, its own agents restricted,
    /// allowlisted on the deposit, and governed: the factory keeps nothing.
    function test_issuesAWholeNoteInOneTransaction() public {
        NoteFactory.Note memory n = _issue(_params("S2", 50, true));
        INote note = INote(n.token);
        assertEq(note.balanceOf(inventory), 50, "the notional is in the inventory");
        assertFalse(note.paused(), "open for transfers");
        assertFalse(note.isAgent(address(f)), "the factory keeps no agent power");
        assertFalse(note.isAgent(inventory), "nor does the Issuer");
        assertEq(IOwnable2Step(n.token).owner(), address(p.controller), "governed from the first block");
        assertTrue(p.controller.isGoverned(n.token));
        assertTrue(d.deposit.allowlisted(n.payingAgent) && d.deposit.allowlisted(n.settlement), "allowlisted at issuance");
        assertEq(address(Issuance.issued(n).recordDates.DETERMINATIONS()), n.determinations, "the record dates read the terms");
        assertEq(address(Issuance.issued(n).payingAgent.NOTE()), n.token, "the Paying Agent services this note");
        assertEq(Issuance.issued(n).payingAgent.INVENTORY(), inventory);
    }

    /// Each note's lifecycle contracts are its own clones, initialised once, never again.
    function test_eachNoteHasItsOwnClones() public {
        NoteFactory.Note memory n = _issue(_params("S2", 0, false));
        assertTrue(n.determinations != address(l.determinations) && n.payingAgent != address(l.payingAgent));
        assertEq(n.payingAgent.code.length, 45, "a minimal clone");
        IDeterminationAgent.Terms memory t = _terms();
        vm.expectRevert(DeterminationAgent.AlreadyInitialized.selector);
        DeterminationAgent(n.determinations).initialize(t, IProgrammeRoles(address(this)));
        vm.expectRevert(PayingAgent.AlreadyInitialized.selector);
        PayingAgent(n.payingAgent).initialize(
            INoteServicing(address(0)), ICashLeg(address(0)), IDeterminationAgent(address(0)), IRecordDates(address(0)), address(0), IProgrammeRoles(address(0))
        );
        vm.expectRevert(DeterminationAgent.AlreadyInitialized.selector);
        DeterminationAgent(d.implementations.determinations).initialize(t, IProgrammeRoles(address(this)));
    }

    /// Each note takes the next series number, its salt, and states it, with any ISIN, on its identity.
    function test_eachNoteHasASeriesIdentity() public {
        NoteFactory.Params memory q = _params("S2", 0, false);
        q.isin = "XS0000000001";
        NoteFactory.Note memory n = _issue(q);
        assertEq(n.series, l.series + 1, "the next series");
        assertEq(f.tokenOfSeries(n.series), n.token);
        IIdentity id = IIdentity(n.identity);
        (uint256 topic,,,, bytes memory data,) = id.getClaim(keccak256(abi.encode(n.identity, ClaimTopics.SERIES)));
        assertEq(topic, ClaimTopics.SERIES);
        (uint256 series, string memory isin) = abi.decode(data, (uint256, string));
        assertEq(series, n.series);
        assertEq(isin, "XS0000000001");
        (topic,,,, data,) = id.getClaim(keccak256(abi.encode(n.identity, ClaimTopics.TERM_SHEET)));
        (bytes32 hash,) = abi.decode(data, (bytes32, string));
        assertEq(hash, keccak256("S2"), "and its term sheet");
        assertTrue(id.keyHasPurpose(keccak256(abi.encode(address(p.controller))), 1), "the controller manages the identity");
        assertFalse(id.keyHasPurpose(keccak256(abi.encode(address(f))), 1), "the factory does not");

        q.isin = "TOO-SHORT";
        vm.prank(address(issuerGov));
        vm.expectRevert(NoteFactory.InvalidArgument.selector);
        f.issue(q);
    }

    /// Several notes in one call, each a series of its own.
    function test_issuesSeveralNotesInOneCall() public {
        NoteFactory.Params[] memory qs = new NoteFactory.Params[](3);
        qs[0] = _params("A1", 10, true);
        qs[1] = _params("A2", 20, true);
        qs[2] = _params("A3", 0, false);
        vm.prank(address(issuerGov));
        NoteFactory.Note[] memory ns = f.issueMany(qs);
        assertEq(ns.length, 3);
        assertEq(ns[2].series, ns[0].series + 2);
        assertEq(INote(ns[1].token).balanceOf(inventory), 20);
        assertEq(p.controller.notes().length, 4, "all governed");
    }

    /// Every note requires the onboarding agent's note claim, and a series may require more.
    function test_aSeriesMayRequireFurtherClaims() public {
        uint256 professional = uint256(keccak256("claim.professional-investor"));
        uint256 dealerKey = 0xDEA1;
        ExpiringClaimIssuer dealer = new ExpiringClaimIssuer(vm.addr(dealerKey), 365 days);
        NoteFactory.Params memory q = _params("PRO", 0, false);
        q.extraTopics = new uint256[](1);
        q.extraTopics[0] = professional;
        q.extraIssuers = new address[](1);
        q.extraIssuers[0] = address(dealer);
        NoteFactory.Note memory n = _issue(q);

        address holder = makeAddr("note holder");
        _onboard(holder, true);
        assertTrue(l.identityRegistry.isVerified(holder), "eligible for the programme's notes");
        assertFalse(Issuance.issued(n).identityRegistry.isVerified(holder), "not yet for this series");
        vm.prank(bank);
        Onboarding.consent(identityOf[holder], vm.addr(dealerKey));
        vm.startPrank(vm.addr(dealerKey));
        Onboarding.vouch(dealer, dealerKey, identityOf[holder], professional, uint48(block.timestamp + 30 days), keccak256("dealer record"));
        vm.stopPrank();
        assertTrue(Issuance.issued(n).identityRegistry.isVerified(holder), "with the dealer's claim, it is");
    }

    /// The notional is minted only to an inventory the note's registry accepts.
    function test_mintingNeedsAnEligibleInventory() public {
        NoteFactory.Params memory q = _params("S2", 10, true);
        q.issuer = makeAddr("not onboarded");
        vm.prank(address(issuerGov));
        vm.expectRevert();
        f.issue(q);
    }

    // --- the Issuer's wallet alone ---

    function test_onlyTheIssuersWalletIssues() public {
        NoteFactory.Params memory q = _params("S2", 0, false);
        vm.prank(inventory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, inventory));
        f.issue(q);
    }

    /// T-REX's factory belongs to the note factory, so no note is issued around it.
    function test_noNoteIsIssuedAroundTheFactory() public {
        assertEq(Ownable(address(d.trexFactory)).owner(), address(f));
        ITREXFactory.TokenDetails memory t;
        ITREXFactory.ClaimDetails memory c;
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        d.trexFactory.deployTREXSuite("around", t, c);
    }

    /// Only the controller retires a note or releases the storage.
    function test_stewardshipIsTheControllers() public {
        vm.expectRevert(abi.encodeWithSelector(NoteFactory.NotGovernance.selector, address(this)));
        f.retire(address(l.note));
        vm.prank(address(issuerGov));
        vm.expectRevert(abi.encodeWithSelector(NoteFactory.NotGovernance.selector, address(issuerGov)));
        f.releaseTrexFactory(address(1));
    }

    // --- the record ---

    function test_everyNoteIsRecorded() public {
        uint256 before = f.noteCount();
        NoteFactory.Note memory n = _issue(_params("S2", 0, false));
        assertEq(f.noteCount(), before + 1);
        assertEq(f.notes()[before], n.token);
        assertEq(f.noteOf(n.token).payingAgent, n.payingAgent);
        assertEq(f.noteOf(n.token).series, n.series);
    }

    /// What one issuance costs, on the local node's gas schedule: clones keep it low.
    function test_issuanceCost() public {
        NoteFactory.Params memory q = _params("GAS", 0, false);
        vm.prank(address(issuerGov));
        uint256 before = gasleft();
        f.issue(q);
        uint256 used = before - gasleft();
        emit log_named_uint("gas for one issuance", used);
        assertLt(used, 9_000_000);
    }
}
