// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.30;

import {IDeterminationAgent} from "../interfaces/IDeterminationAgent.sol";
import {INote} from "../interfaces/INote.sol";
import {PayingAgent, INoteServicing, ICashLeg, IRecordDates} from "../PayingAgent.sol";
import {LockedSettlement, ICashLeg as ISettlementCash} from "../LockedSettlement.sol";

/**
 * Deploys a note's servicing for the note factory (ADR 0091): the Paying Agent and the locked
 * settlement contract. Kept apart from the factory so that each stays under the contract size limit.
 * It holds nothing and grants nothing; whoever calls it gets two new contracts.
 */
contract ServicingDeployer {
    struct Servicing {
        address note;
        address cash;
        address determinations;
        address recordDates;
        /// @dev The Issuer's inventory, which redemptions skip and buy-backs fill.
        address inventory;
        /// @dev Whose deposit funds distributions: the Agent.
        address funder;
        /// @dev The Paying Agent's administrator: the Issuer.
        address admin;
        /// @dev Who pays: the Agent's servicing wallet.
        address payer;
    }

    function deploy(Servicing calldata s) external returns (PayingAgent payingAgent, LockedSettlement settlement) {
        payingAgent = new PayingAgent(
            INoteServicing(s.note),
            ICashLeg(s.cash),
            IDeterminationAgent(s.determinations),
            IRecordDates(s.recordDates),
            s.inventory,
            s.funder,
            s.admin,
            s.payer
        );
        settlement = new LockedSettlement(INote(s.note), ISettlementCash(s.cash));
    }
}
