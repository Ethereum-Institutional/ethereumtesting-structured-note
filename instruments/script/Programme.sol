// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {GovernanceController} from "../src/GovernanceController.sol";
import {NoteFactory} from "../src/factory/NoteFactory.sol";
import {ProgrammeSanctions} from "../src/compliance/ProgrammeSanctions.sol";
import {IOwnable2Step} from "../src/interfaces/INote.sol";
import {Scaffolding} from "./Scaffolding.sol";

interface IRoleAdmin {
    function grantRole(bytes32 role, address account) external;
    function renounceRole(bytes32 role, address account) external;
}

/**
 * The note programme on the scaffolding (ADR 0115): its sanctions module, its governance controller
 * and its note factory, each naming the others, built once before any note. Used by the deploy
 * scripts and the tests alike.
 *
 * - **The controller** holds the programme's roles (the servicing wallet, the Calculation Agent,
 *   the funder) and every governed power. It administers the deposit and its gateway from here on,
 *   so that it can let each note's Paying Agent reverse a coupon on the deposit.
 * - **The note factory** is owned by the Issuer's multi-signature wallet, owns T-REX's factory, and
 *   may allowlist each note's lifecycle contracts on the deposit, a role the bank's deposit grants.
 *
 * Then {ceremony}, after the deployment's first notes: the pool's identity registries and the venue
 * handed to the controller, and the deployer renouncing every power it still holds.
 *
 * Must be called by `c.deployer`, the deposit's and gateway's administrator until the ceremony.
 */
library Programme {
    bytes32 internal constant ADMIN = 0x00;
    bytes32 internal constant SUPERVISOR_ROLE = keccak256("SUPERVISOR_ROLE");

    struct Venue {
        address checker;
        address adapter;
        address credentialGate;
    }

    struct Config {
        address deployer;
        /// @dev The Issuer's multi-signature wallet: the note factory's owner.
        address issuerWallet;
        address[] institutions;
        address agentGovernance;
        address servicingWallet;
        address calculationAgent;
        /// @dev The Agent's deposit account, which funds every distribution.
        address funder;
        uint256 minInstitutions;
        uint256 minSignatures;
        uint48 tier2Delay;
        uint48 recoveryDelay;
        uint48 executionWindow;
        /// @dev All zero: no venue.
        Venue venue;
    }

    struct Deployed {
        GovernanceController controller;
        NoteFactory factory;
        ProgrammeSanctions sanctions;
    }

    function deploy(Scaffolding.Deployed memory d, Config memory c) internal returns (Deployed memory p) {
        p.sanctions = new ProgrammeSanctions();
        p.controller = new GovernanceController(
            GovernanceController.Config({
                deposit: address(d.deposit),
                gateway: address(d.gateway),
                sanctions: address(p.sanctions),
                institutions: c.institutions,
                agentGovernance: c.agentGovernance,
                servicingWallet: c.servicingWallet,
                calculationAgent: c.calculationAgent,
                funder: c.funder,
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
        p.sanctions.bindGovernance(address(p.controller));
        p.factory = new NoteFactory(
            c.issuerWallet,
            NoteFactory.Scaffold({
                trexFactory: address(d.trexFactory),
                identityStorage: address(d.identities),
                deposit: address(d.deposit),
                noteClaimIssuer: address(d.onboardingIssuer),
                sanctions: address(p.sanctions),
                governance: address(p.controller),
                implementations: d.implementations
            })
        );
        p.controller.bindFactory(address(p.factory));
        d.trexFactory.transferOwnership(address(p.factory));
        d.deposit.grantRole(d.deposit.ALLOWLIST_ROLE(), address(p.factory));
        d.deposit.grantRole(ADMIN, address(p.controller));
        d.gateway.grantRole(ADMIN, address(p.controller));
    }

    /**
     * The ceremony: the pool's identity registries and, where there is one, the venue offered to the
     * controller and accepted in the same sequence; the pool's gate supervised by it; and the
     * deployer's renunciation of everything it still administers, last.
     */
    function ceremony(Scaffolding.Deployed memory d, Deployed memory p, Venue memory v, address deployer) internal {
        address controller = address(p.controller);
        bool venue = v.checker != address(0);
        address[] memory owned = new address[](venue ? 5 : 3);
        owned[0] = address(d.poolRegistry);
        owned[1] = address(d.poolTopics);
        owned[2] = address(d.poolIssuers);
        if (venue) (owned[3], owned[4]) = (v.checker, v.adapter);
        for (uint256 k = 0; k < owned.length; ++k) {
            IOwnable2Step(owned[k]).transferOwnership(controller);
        }
        p.controller.acceptOwnerships(owned);
        if (venue) {
            IRoleAdmin(v.credentialGate).grantRole(ADMIN, controller);
            IRoleAdmin(v.credentialGate).grantRole(SUPERVISOR_ROLE, controller);
            IRoleAdmin(v.credentialGate).renounceRole(ADMIN, deployer);
        }
        d.deposit.renounceRole(ADMIN, deployer);
        d.gateway.renounceRole(ADMIN, deployer);
    }
}
