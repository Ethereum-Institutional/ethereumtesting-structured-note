// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {GovernanceController} from "../src/GovernanceController.sol";
import {Instruments} from "./Instruments.sol";
import {Lifecycle} from "./Lifecycle.sol";

/**
 * The governance ceremony: every privileged role moved to its final holder, and the deployer's
 * renunciation as the last act (ADR 0025). Used by the ceremony script and the tests alike.
 *
 * Must be called by the deployer, which holds each contract's admin role until the end.
 *
 * Final holders:
 * - **Controller:** admin of the note, the deposit, the registry, the Paying Agent and the deposit
 *   gateway; upgrade on both tokens; the note's mint and burn (notional amendment) and forced
 *   transfer (register correction); supervisory withdrawal; reversal and restatement.
 * - **Agent servicing wallet:** the note's pause, freeze and document roles; paying.
 * - **Paying Agent:** the note's burn and pause for redemptions (Wave 3), and forced transfer on
 *   the deposit, which it uses only when the controller reverses a distribution.
 * - **Deposit Agent** and **gateway:** unchanged from Wave 2.
 * - **No one:** the note's snapshot and terms roles, so the record-date engine and the terms are
 *   fixed for the life of the note.
 * - **Deployer and the interim Agent key:** nothing.
 */
library Governance {
    struct Config {
        address deployer;
        address interimAgent;
        address[] institutions;
        address agentGovernance;
        address servicingWallet;
        uint256 minInstitutions;
        uint256 minSignatures;
        uint48 tier2Delay;
        uint48 recoveryDelay;
    }

    bytes32 internal constant ADMIN = 0x00;

    function ceremony(Instruments.Deployed memory d, Lifecycle.Issued memory l, Config memory c)
        internal
        returns (GovernanceController g)
    {
        g = new GovernanceController(
            GovernanceController.Config({
                note: address(d.note),
                deposit: address(d.deposit),
                registry: address(d.registry),
                payingAgent: address(l.payingAgent),
                institutions: c.institutions,
                agentGovernance: c.agentGovernance,
                servicingWallet: c.servicingWallet,
                minInstitutions: c.minInstitutions,
                minSignatures: c.minSignatures,
                tier2Delay: c.tier2Delay,
                recoveryDelay: c.recoveryDelay
            })
        );
        address controller = address(g);

        // Note.
        d.note.grantRole(ADMIN, controller);
        d.note.grantRole(d.note.PROXY_UPGRADE_ROLE(), controller);
        d.note.grantRole(d.note.MINTER_ROLE(), controller);
        d.note.grantRole(d.note.BURNER_ROLE(), controller);
        d.note.grantRole(d.note.FORCED_TRANSFER_ROLE(), controller);
        d.note.grantRole(d.note.PAUSER_ROLE(), c.servicingWallet);
        d.note.grantRole(d.note.ENFORCER_ROLE(), c.servicingWallet);
        d.note.grantRole(d.note.ERC20ENFORCER_ROLE(), c.servicingWallet);
        d.note.grantRole(d.note.DOCUMENT_ROLE(), c.servicingWallet);
        bytes32[8] memory interim = [
            d.note.MINTER_ROLE(),
            d.note.BURNER_ROLE(),
            d.note.PAUSER_ROLE(),
            d.note.ENFORCER_ROLE(),
            d.note.ERC20ENFORCER_ROLE(),
            d.note.SNAPSHOOTER_ROLE(),
            d.note.DOCUMENT_ROLE(),
            d.note.EXTRA_INFORMATION_ROLE()
        ];
        for (uint256 k = 0; k < interim.length; ++k) {
            d.note.revokeRole(interim[k], c.interimAgent);
        }

        // Deposit.
        d.deposit.grantRole(ADMIN, controller);
        d.deposit.grantRole(d.deposit.PROXY_UPGRADE_ROLE(), controller);
        d.deposit.grantRole(d.deposit.FORCED_TRANSFER_ROLE(), address(l.payingAgent));

        // Registry.
        d.registry.grantRole(ADMIN, controller);
        d.registry.grantRole(d.registry.SUPERVISOR_ROLE(), controller);

        // Paying Agent.
        l.payingAgent.grantRole(ADMIN, controller);
        l.payingAgent.grantRole(l.payingAgent.REVERSER_ROLE(), controller);
        l.payingAgent.grantRole(l.payingAgent.PAYER_ROLE(), c.servicingWallet);
        l.payingAgent.revokeRole(l.payingAgent.PAYER_ROLE(), c.interimAgent);

        // Deposit gateway.
        d.gateway.grantRole(ADMIN, controller);

        // The deployer's renunciation, last.
        d.note.renounceRole(ADMIN, c.deployer);
        d.deposit.renounceRole(ADMIN, c.deployer);
        d.registry.renounceRole(ADMIN, c.deployer);
        l.payingAgent.renounceRole(ADMIN, c.deployer);
        d.gateway.renounceRole(ADMIN, c.deployer);
    }
}
