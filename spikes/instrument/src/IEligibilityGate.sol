// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;
import {IRuleEngine} from "debt-standard/interfaces/engine/IRuleEngine.sol";
/// Per-instrument gate: a rule engine that also answers account-level eligibility.
interface IEligibilityGate is IRuleEngine {
    function canSend(address account) external view returns (bool);
    function canReceive(address account) external view returns (bool);
}
