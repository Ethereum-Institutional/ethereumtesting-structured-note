// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {GovernanceController} from "../src/GovernanceController.sol";
import {INote, IOwnable2Step} from "../src/interfaces/INote.sol";
import {NoteFactory} from "../src/factory/NoteFactory.sol";
import {AgentPowers} from "../src/factory/AgentPowers.sol";
import {Scaffolding} from "./Scaffolding.sol";
import {Issuance} from "./Issuance.sol";

interface IRoleAdmin {
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
    function renounceRole(bytes32 role, address account) external;
}

/**
 * The governance ceremony: every privileged power moved to its final holder, and the deployer's
 * renunciation as the last act (ADR 0025). Used by the ceremony script and the tests alike.
 *
 * Must be called by the deployer, the Issuer, which owns the note through the note factory
 * (ADR 0091) and administers the lifecycle and the deposit until the end.
 *
 * Final holders:
 * - **Controller:** owner of the note, its identity registry, trusted issuers, claim topics and
 *   compliance, and manager of the note's identity; the note's agent for notional amendment,
 *   register correction, the supervisory freeze and wallet recovery (ADR 0088); admin of the
 *   Paying Agent, the deposit and the deposit gateway; reversal and restatement.
 * - **Agent servicing wallet:** the note's agent for pausing and freezing part of a holding;
 *   paying.
 * - **Paying Agent:** the note's agent for burning and pausing at redemption, and forced transfer
 *   on the deposit, which it uses only when the controller reverses a distribution.
 * - **Settlement contract:** the note's agent for freezing part of a holding while an offer is open.
 * - **Onboarding agent:** the agent of the note's identity registry.
 * - **The bank:** the deposit's eligibility and its pause, allowlist and freezing.
 * - **Venue** (ADRs 0039, 0090): the controller owns the pool's identity registries, its topics
 *   and trusted issuers, always; where the pool is deployed it also owns the checker and the
 *   deposit's permissions adapter and holds the pool gate's admin and supervisor roles.
 * - **Deployer and the interim Agent key:** nothing on the note or its lifecycle. The deployer, as
 *   the Issuer, keeps the note factory, to issue further notes; the factory holds nothing of this
 *   note once it is handed over.
 */
library Governance {
    struct Config {
        address deployer;
        /// @dev The Issuer's key, an agent of the note until now for minting into its inventory.
        address issuer;
        address interimAgent;
        address[] institutions;
        address agentGovernance;
        address servicingWallet;
        uint256 minInstitutions;
        uint256 minSignatures;
        uint48 tier2Delay;
        uint48 recoveryDelay;
        uint48 executionWindow;
        Venue venue;
    }

    /// @dev The venue's contracts, owned by the deployer until the ceremony. All zero: no venue.
    struct Venue {
        address checker;
        address adapter;
        address credentialGate;
    }

    bytes32 internal constant ADMIN = 0x00;
    bytes32 internal constant SUPERVISOR_ROLE = keccak256("SUPERVISOR_ROLE");

    function ceremony(Scaffolding.Deployed memory d, Issuance.Issued memory l, Config memory c)
        internal
        returns (GovernanceController g)
    {
        g = new GovernanceController(
            GovernanceController.Config({
                note: address(l.note),
                deposit: address(d.deposit),
                trustedIssuers: l.trustedIssuers,
                recordDates: address(l.recordDates),
                payingAgent: address(l.payingAgent),
                institutions: c.institutions,
                agentGovernance: c.agentGovernance,
                servicingWallet: c.servicingWallet,
                minInstitutions: c.minInstitutions,
                minSignatures: c.minSignatures,
                tier2Delay: c.tier2Delay,
                recoveryDelay: c.recoveryDelay,
                executionWindow: c.executionWindow,
                checker: c.venue.checker,
                adapter: c.venue.adapter,
                credentialGate: c.venue.credentialGate
            })
        );
        address controller = address(g);

        // The note's agents, through the factory that owns the note: the controller and the
        // servicing wallet in, the Issuer out.
        address note = address(l.note);
        NoteFactory f = d.noteFactory;
        f.administer(note, note, abi.encodeCall(INote.addAgent, (controller)));
        f.administer(note, note, abi.encodeCall(INote.setAgentRestrictions, (controller, AgentPowers.controller())));
        f.administer(note, note, abi.encodeCall(INote.addAgent, (c.servicingWallet)));
        f.administer(note, note, abi.encodeCall(INote.setAgentRestrictions, (c.servicingWallet, g.servicingRestrictions())));
        f.administer(note, note, abi.encodeCall(INote.removeAgent, (c.issuer)));

        // Paying Agent.
        l.payingAgent.grantRole(ADMIN, controller);
        l.payingAgent.grantRole(l.payingAgent.REVERSER_ROLE(), controller);
        l.payingAgent.grantRole(l.payingAgent.PAYER_ROLE(), c.servicingWallet);
        l.payingAgent.revokeRole(l.payingAgent.PAYER_ROLE(), c.interimAgent);

        // Deposit and gateway.
        d.deposit.grantRole(ADMIN, controller);
        d.deposit.grantRole(d.deposit.FORCED_TRANSFER_ROLE(), address(l.payingAgent));
        d.gateway.grantRole(ADMIN, controller);

        // Ownership, offered and accepted in the same sequence: the note and its registries, which
        // the factory hands over with the management of the note's identity; the pool's identity
        // registries; and the venue where there is one.
        f.handOver(note, controller);
        bool venue = c.venue.checker != address(0);
        address[] memory owned = new address[](venue ? 10 : 8);
        owned[0] = note;
        owned[1] = address(l.identityRegistry);
        owned[2] = l.trustedIssuers;
        owned[3] = l.claimTopics;
        owned[4] = l.compliance;
        owned[5] = address(d.poolRegistry);
        owned[6] = address(d.poolTopics);
        owned[7] = address(d.poolIssuers);
        if (venue) (owned[8], owned[9]) = (c.venue.checker, c.venue.adapter);
        for (uint256 k = 5; k < owned.length; ++k) {
            IOwnable2Step(owned[k]).transferOwnership(controller);
        }
        g.acceptOwnerships(owned);
        if (venue) {
            IRoleAdmin(c.venue.credentialGate).grantRole(ADMIN, controller);
            IRoleAdmin(c.venue.credentialGate).grantRole(SUPERVISOR_ROLE, controller);
        }

        // The deployer's renunciation, last.
        l.payingAgent.renounceRole(ADMIN, c.deployer);
        d.deposit.renounceRole(ADMIN, c.deployer);
        d.gateway.renounceRole(ADMIN, c.deployer);
        if (venue) IRoleAdmin(c.venue.credentialGate).renounceRole(ADMIN, c.deployer);
    }
}
