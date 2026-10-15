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
import {Scaffolding} from "./Scaffolding.sol";

/**
 * Issuance of one note on the shared scaffolding, through the note factory in one transaction
 * (ADRs 0088, 0091). Used by the issuance script and the tests alike.
 *
 * - **The token** is T-REX's, on the deployment's identity storage, with decimals zero, so a
 *   balance is a count of €1,000 units. Its registry requires the note claim, from the onboarding
 *   agent's claim issuer; its compliance carries the note's record-date module. The onboarding
 *   agent is the registry's agent.
 * - **The term sheet** is anchored on the note's own identity, as a claim its owner makes about it.
 * - **Agents,** each restricted to its own powers (ADR 0085): the Issuer mints into its inventory
 *   and unpauses; the Paying Agent burns at redemption and pauses at a redemption; the settlement
 *   contract freezes and unfreezes part of a holding while an offer is open.
 * - **The factory owns the note** for the Issuer until the ceremony hands it over.
 *
 * Must be called by the note factory's owner, the Issuer.
 */
library Issuance {
    struct Config {
        /// @dev The Issuer's inventory and the note's minting agent.
        address issuer;
        address calculationAgent;
        address payer;
        address funder;
        string name;
        string symbol;
        /// @dev Unique to the note within T-REX's factory.
        string salt;
        bytes32 termSheetHash;
        string termSheetUri;
        /// @dev Minted to the inventory at issuance, which must then be eligible; zero mints nothing.
        uint256 units;
        /// @dev Whether to open the note for transfers at issuance.
        bool open;
    }

    struct Issued {
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

    function issue(Scaffolding.Deployed memory d, IDeterminationAgent.Terms memory terms, Config memory c)
        internal
        returns (Issued memory l)
    {
        NoteFactory.Note memory n = d.noteFactory.issue(
            NoteFactory.Params({
                salt: c.salt,
                name: c.name,
                symbol: c.symbol,
                terms: terms,
                issuer: c.issuer,
                calculationAgent: c.calculationAgent,
                funder: c.funder,
                payer: c.payer,
                termSheetHash: c.termSheetHash,
                termSheetUri: c.termSheetUri,
                units: c.units,
                open: c.open,
                agents: new NoteFactory.AgentGrant[](0)
            })
        );
        l = issued(n);
    }

    /// A note's contracts, as the factory records them.
    function issued(NoteFactory.Note memory n) internal pure returns (Issued memory l) {
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

    /// The deposit allowlists the Paying Agent and the settlement contract, which hold it in
    /// transit and move it under allowances, in one call. Must be called by the bank.
    function allowlist(Scaffolding.Deployed memory d, Issued memory l) internal {
        address[] memory accounts = new address[](2);
        (accounts[0], accounts[1]) = (address(l.payingAgent), address(l.settlement));
        d.deposit.setAllowlistedMany(accounts, true);
    }

    // --- restrictions (ADR 0085), as the factory applies them ---

    function issuerRestrictions() internal pure returns (AgentRestrictions memory) {
        return AgentPowers.issuer();
    }

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
