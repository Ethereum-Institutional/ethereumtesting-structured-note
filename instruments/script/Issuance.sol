// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {IERC3643IdentityRegistry} from "t-rex/ERC-3643/IERC3643IdentityRegistry.sol";

import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {INote, AgentRestrictions} from "../src/interfaces/INote.sol";
import {DeterminationAgent} from "../src/DeterminationAgent.sol";
import {RecordDateModule} from "../src/compliance/RecordDateModule.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {LockedSettlement} from "../src/LockedSettlement.sol";
import {NoteFactory} from "../src/factory/NoteFactory.sol";
import {AgentPowers} from "../src/factory/AgentPowers.sol";

/**
 * Issuance of a note through the note factory, in one transaction: its series identity,
 * its terms, its T-REX suite with the programme's checks, its lifecycle contracts as clones,
 * allowlisted on the deposit, the notional minted to the Issuer's inventory, and the note handed to
 * the governance controller. Used by the issuance script and the tests alike.
 *
 * The factory's owner, the Issuer's multi-signature wallet, issues: the tests act as it, and the
 * script has the wallet's signers sign the call.
 */
library Issuance {
    struct Config {
        /// @dev The Issuer's inventory, which the notional is minted to.
        address issuer;
        /// @dev Twelve characters, or empty where the note has none.
        string isin;
        string name;
        string symbol;
        bytes32 termSheetHash;
        string termSheetUri;
        /// @dev Minted to the inventory at issuance, which must then be eligible; zero mints nothing.
        uint256 units;
        /// @dev Whether to open the note for transfers at issuance.
        bool open;
    }

    struct Issued {
        uint256 series;
        INote note;
        address identity;
        IERC3643IdentityRegistry identityRegistry;
        address compliance;
        address trustedIssuers;
        address claimTopics;
        DeterminationAgent determinations;
        RecordDateModule recordDates;
        PayingAgent payingAgent;
        LockedSettlement settlement;
    }

    /// The factory's parameters for a note.
    function params(IDeterminationAgent.Terms memory terms, Config memory c)
        internal
        pure
        returns (NoteFactory.Params memory)
    {
        return NoteFactory.Params({
            isin: c.isin,
            name: c.name,
            symbol: c.symbol,
            terms: terms,
            issuer: c.issuer,
            termSheetHash: c.termSheetHash,
            termSheetUri: c.termSheetUri,
            units: c.units,
            open: c.open,
            extraTopics: new uint256[](0),
            extraIssuers: new address[](0)
        });
    }

    /// Issues a note. Must be called as the factory's owner.
    function issue(NoteFactory f, IDeterminationAgent.Terms memory terms, Config memory c)
        internal
        returns (Issued memory)
    {
        return issued(f.issue(params(terms, c)));
    }

    /// A note's contracts, as the factory records them.
    function issued(NoteFactory.Note memory n) internal pure returns (Issued memory l) {
        l.series = n.series;
        l.note = INote(n.token);
        l.identity = n.identity;
        l.identityRegistry = IERC3643IdentityRegistry(n.identityRegistry);
        l.compliance = n.compliance;
        l.trustedIssuers = n.trustedIssuers;
        l.claimTopics = n.claimTopics;
        l.determinations = DeterminationAgent(n.determinations);
        l.recordDates = RecordDateModule(n.recordDates);
        l.payingAgent = PayingAgent(n.payingAgent);
        l.settlement = LockedSettlement(n.settlement);
    }

    // --- restrictions, as the factory applies them ---

    function payingAgentRestrictions() internal pure returns (AgentRestrictions memory) {
        return AgentPowers.payingAgent();
    }

    function settlementRestrictions() internal pure returns (AgentRestrictions memory) {
        return AgentPowers.settlement();
    }

    function controllerRestrictions() internal pure returns (AgentRestrictions memory) {
        return AgentPowers.controller();
    }
}
