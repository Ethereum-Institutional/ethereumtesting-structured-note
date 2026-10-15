// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {IDeterminationAgent} from "../interfaces/IDeterminationAgent.sol";
import {DeterminationAgent} from "../DeterminationAgent.sol";
import {RecordDateModule} from "../compliance/RecordDateModule.sol";

/**
 * Deploys a note's terms and its record dates for the note factory (ADR 0091): the Determination
 * Agent, which fixes the terms, and the record-date module the note's compliance carries. Kept apart
 * from the factory so that each stays under the contract size limit. It holds nothing and grants
 * nothing; whoever calls it gets two new contracts.
 */
contract TermsDeployer {
    function deploy(IDeterminationAgent.Terms calldata terms, address calculationAgent)
        external
        returns (DeterminationAgent determinations, RecordDateModule recordDates)
    {
        determinations = new DeterminationAgent(terms, calculationAgent);
        recordDates = new RecordDateModule(determinations);
    }
}
