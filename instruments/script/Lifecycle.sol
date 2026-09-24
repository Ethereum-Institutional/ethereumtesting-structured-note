// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {ISnapshotEngine} from "debt-standard/interfaces/engine/ISnapshotEngine.sol";
import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {DeterminationAgent} from "../src/DeterminationAgent.sol";
import {RecordDateEngine, IBalances} from "../src/RecordDateEngine.sol";
import {PayingAgent, INoteServicing, ICashLeg, IRecordDates} from "../src/PayingAgent.sol";
import {DvPSettlement, ISettlementLeg} from "../src/DvPSettlement.sol";
import {Instruments} from "./Instruments.sol";

/**
 * Issuance: the lifecycle contracts for one note, built once its terms are fixed. Used by the
 * issuance script and the tests alike.
 *
 * Must be called by the instruments' deployer, which is the note's admin. It gives itself the
 * snapshot role only for as long as it takes to attach the record-date engine, and renounces it
 * in the same sequence, so the grant and the renunciation are both on the record.
 *
 * The Paying Agent must also be onboarded to the registry for the cash leg before it can be
 * funded; the Access Issuer does that, not this library.
 */
library Lifecycle {
    struct Config {
        address deployer;
        address calculationAgent;
        address agent;
        address inventory;
        address funder;
    }

    struct Issued {
        DeterminationAgent determinations;
        RecordDateEngine recordDates;
        PayingAgent payingAgent;
        DvPSettlement settlement;
    }

    function issue(Instruments.Deployed memory d, IDeterminationAgent.Terms memory terms, Config memory c)
        internal
        returns (Issued memory l)
    {
        l.determinations = new DeterminationAgent(terms, c.calculationAgent);
        l.recordDates = new RecordDateEngine(IBalances(address(d.note)), l.determinations);

        bytes32 snapshooter = d.note.SNAPSHOOTER_ROLE();
        d.note.grantRole(snapshooter, c.deployer);
        d.note.setSnapshotEngine(ISnapshotEngine(address(l.recordDates)));
        d.note.renounceRole(snapshooter, c.deployer);

        l.payingAgent = new PayingAgent(
            INoteServicing(address(d.note)),
            ICashLeg(address(d.deposit)),
            l.determinations,
            IRecordDates(address(l.recordDates)),
            c.inventory,
            c.funder,
            c.deployer,
            c.agent
        );
        d.note.grantRole(d.note.BURNER_ROLE(), address(l.payingAgent));
        d.note.grantRole(d.note.PAUSER_ROLE(), address(l.payingAgent));

        l.settlement = new DvPSettlement(ISettlementLeg(address(d.note)), ISettlementLeg(address(d.deposit)));
    }
}
