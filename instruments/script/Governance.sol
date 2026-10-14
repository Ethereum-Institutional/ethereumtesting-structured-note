// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {IIdentity} from "@onchain-id/solidity/contracts/interface/IIdentity.sol";
import {KeyPurposes} from "@onchain-id/solidity/contracts/libraries/KeyPurposes.sol";
import {KeyTypes} from "@onchain-id/solidity/contracts/libraries/KeyTypes.sol";
import {Token} from "t-rex/token/Token.sol";
import {GovernanceController} from "../src/GovernanceController.sol";
import {IOwnable2Step} from "../src/interfaces/INote.sol";
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
 * Must be called by the deployer, which owns the note and administers the lifecycle and the
 * deposit until the end.
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
 * - **Venue** (ADR 0039), where there is one: the controller owns the checker and the deposit's
 *   permissions adapter and holds the pool credential gate's admin and supervisor roles.
 * - **Deployer and the interim Agent key:** nothing on the note or its lifecycle. The deployer, as
 *   the Issuer, keeps T-REX's factory, to issue further notes.
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

        // The note's agents: the controller and the servicing wallet in, the Issuer out.
        l.note.addAgent(controller);
        l.note.setAgentRestrictions(controller, Issuance.controllerRestrictions());
        l.note.addAgent(c.servicingWallet);
        l.note.setAgentRestrictions(c.servicingWallet, g.servicingRestrictions());
        l.note.removeAgent(c.issuer);

        // The note's identity: managed by the controller.
        IIdentity identity = IIdentity(Token(address(l.note)).onchainID());
        identity.addKey(keccak256(abi.encode(controller)), KeyPurposes.MANAGEMENT, KeyTypes.ECDSA);
        identity.removeKey(keccak256(abi.encode(c.deployer)), KeyPurposes.MANAGEMENT);

        // Paying Agent.
        l.payingAgent.grantRole(ADMIN, controller);
        l.payingAgent.grantRole(l.payingAgent.REVERSER_ROLE(), controller);
        l.payingAgent.grantRole(l.payingAgent.PAYER_ROLE(), c.servicingWallet);
        l.payingAgent.revokeRole(l.payingAgent.PAYER_ROLE(), c.interimAgent);

        // Deposit and gateway.
        d.deposit.grantRole(ADMIN, controller);
        d.deposit.grantRole(d.deposit.FORCED_TRANSFER_ROLE(), address(l.payingAgent));
        d.gateway.grantRole(ADMIN, controller);

        // Ownership, offered and accepted in the same sequence: the note and its registries, and
        // the venue where there is one.
        bool venue = c.venue.checker != address(0);
        address[] memory owned = new address[](venue ? 7 : 5);
        owned[0] = address(l.note);
        owned[1] = address(l.identityRegistry);
        owned[2] = l.trustedIssuers;
        owned[3] = l.claimTopics;
        owned[4] = l.compliance;
        if (venue) (owned[5], owned[6]) = (c.venue.checker, c.venue.adapter);
        for (uint256 k = 0; k < owned.length; ++k) {
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
