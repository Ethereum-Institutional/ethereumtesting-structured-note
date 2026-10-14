// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {IIdentity} from "@onchain-id/solidity/contracts/interface/IIdentity.sol";
import {ITREXFactory} from "t-rex/factory/ITREXFactory.sol";
import {IERC3643IdentityRegistry} from "t-rex/ERC-3643/IERC3643IdentityRegistry.sol";
import {Token} from "t-rex/token/Token.sol";

import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {INote, AgentRestrictions} from "../src/interfaces/INote.sol";
import {DeterminationAgent} from "../src/DeterminationAgent.sol";
import {RecordDateModule} from "../src/compliance/RecordDateModule.sol";
import {PayingAgent, INoteServicing, ICashLeg, IRecordDates} from "../src/PayingAgent.sol";
import {LockedSettlement, ICashLeg as ISettlementCash} from "../src/LockedSettlement.sol";
import {ClaimTopics} from "../src/claims/ClaimTopics.sol";
import {Scaffolding} from "./Scaffolding.sol";

/**
 * Issuance of one note on the shared scaffolding (ADR 0088): its terms fixed, its token and
 * registries issued as one T-REX suite, and its lifecycle contracts attached as agents with only
 * the powers each needs (ADR 0085). Used by the issuance script and the tests alike.
 *
 * - **The token** is T-REX's, through T-REX's factory, on the deployment's identity storage, with
 *   decimals zero, so a balance is a count of €1,000 units. Its registry requires the note claim,
 *   from the onboarding agent's claim issuer; its compliance carries the note's record-date module.
 *   The onboarding agent is the registry's agent. The token starts paused, as T-REX issues it.
 * - **The term sheet** is anchored on the note's own identity, as a claim its owner makes about it:
 *   the term sheet's hash and where it is.
 * - **Agents,** each restricted to its own powers: the Issuer mints into its inventory and
 *   unpauses; the Paying Agent burns at redemption and pauses at a redemption; the settlement
 *   contract freezes and unfreezes part of a holding while an offer is open.
 *
 * Must be called by the owner of T-REX's factory, which becomes the note's owner until the
 * ceremony hands the note to its governance.
 */
library Issuance {
    struct Config {
        address owner;
        address issuer;
        address calculationAgent;
        address payer;
        address funder;
        address onboardingAgent;
        string name;
        string symbol;
        /// @dev Unique to the note within T-REX's factory.
        string salt;
        bytes32 termSheetHash;
        string termSheetUri;
    }

    struct Issued {
        INote note;
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
        l.determinations = new DeterminationAgent(terms, c.calculationAgent);
        l.recordDates = new RecordDateModule(l.determinations);

        l.note = INote(_suite(d, c, address(l.recordDates)));
        l.identityRegistry = IERC3643IdentityRegistry(l.note.identityRegistry());
        l.compliance = l.note.compliance();
        l.trustedIssuers = address(l.identityRegistry.issuersRegistry());
        l.claimTopics = address(l.identityRegistry.topicsRegistry());

        _anchorTermSheet(l.note, c);

        l.payingAgent = new PayingAgent(
            INoteServicing(address(l.note)),
            ICashLeg(address(d.deposit)),
            l.determinations,
            IRecordDates(address(l.recordDates)),
            c.issuer,
            c.funder,
            c.owner,
            c.payer
        );
        l.settlement = new LockedSettlement(l.note, ISettlementCash(address(d.deposit)));

        l.note.setAgentRestrictions(c.issuer, issuerRestrictions());
        l.note.addAgent(address(l.payingAgent));
        l.note.setAgentRestrictions(address(l.payingAgent), payingAgentRestrictions());
        l.note.addAgent(address(l.settlement));
        l.note.setAgentRestrictions(address(l.settlement), settlementRestrictions());
    }

    /// The deposit allowlists the Paying Agent and the settlement contract, which hold it in
    /// transit and move it under allowances. Must be called by the bank.
    function allowlist(Scaffolding.Deployed memory d, Issued memory l) internal {
        d.deposit.setAllowlisted(address(l.payingAgent), true);
        d.deposit.setAllowlisted(address(l.settlement), true);
    }

    // --- restrictions (ADR 0085) ---

    function issuerRestrictions() internal pure returns (AgentRestrictions memory r) {
        r = _none();
        r.disableMint = false;
        r.disablePause = false;
    }

    function payingAgentRestrictions() internal pure returns (AgentRestrictions memory r) {
        r = _none();
        r.disableBurn = false;
        r.disablePause = false;
    }

    function settlementRestrictions() internal pure returns (AgentRestrictions memory r) {
        r = _none();
        r.disablePartialFreeze = false;
    }

    /// The governance controller: notional amendments, register correction, the supervisory
    /// freeze and wallet recovery.
    function controllerRestrictions() internal pure returns (AgentRestrictions memory r) {
        r = _none();
        r.disableMint = false;
        r.disableBurn = false;
        r.disableForceTransfer = false;
        r.disableAddressFreeze = false;
        r.disableRecovery = false;
    }

    function _none() private pure returns (AgentRestrictions memory) {
        return AgentRestrictions(true, true, true, true, true, true, true);
    }

    // --- internal ---

    function _suite(Scaffolding.Deployed memory d, Config memory c, address recordDates) private returns (address) {
        address[] memory irAgents = new address[](1);
        irAgents[0] = c.onboardingAgent;
        address[] memory tokenAgents = new address[](1);
        tokenAgents[0] = c.issuer;
        address[] memory modules = new address[](1);
        modules[0] = recordDates;

        uint256[] memory topics = new uint256[](1);
        topics[0] = ClaimTopics.NOTE_ELIGIBLE;
        address[] memory issuers = new address[](1);
        issuers[0] = address(d.onboardingIssuer);
        uint256[][] memory issuerTopics = new uint256[][](1);
        issuerTopics[0] = topics;

        d.trexFactory.deployTREXSuite(
            c.salt,
            ITREXFactory.TokenDetails({
                owner: c.owner,
                name: c.name,
                symbol: c.symbol,
                decimals: 0,
                irs: address(d.identities),
                ONCHAINID: address(0),
                irAgents: irAgents,
                tokenAgents: tokenAgents,
                complianceModules: modules,
                complianceSettings: new bytes[](0)
            }),
            ITREXFactory.ClaimDetails({claimTopics: topics, issuers: issuers, issuerClaims: issuerTopics})
        );
        return d.trexFactory.getToken(c.salt);
    }

    /// The note's owner manages the note's identity, and states its term sheet on it.
    function _anchorTermSheet(INote note, Config memory c) private {
        IIdentity identity = IIdentity(Token(address(note)).onchainID());
        identity.addClaim(
            ClaimTopics.TERM_SHEET, 1, address(identity), "", abi.encode(c.termSheetHash, c.termSheetUri), c.termSheetUri
        );
    }
}
