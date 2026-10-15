// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;

import {AgentRestrictions} from "../interfaces/INote.sol";

/**
 * Each agent's powers on a note, as restrictions T-REX applies (ADR 0085): every power off, then
 * those the agent needs on. Used by the factory at issuance, by the ceremony, and by the tests.
 */
library AgentPowers {
    /// The Issuer: mints into its inventory, and pauses and unpauses.
    function issuer() internal pure returns (AgentRestrictions memory r) {
        r = none();
        r.disableMint = false;
        r.disablePause = false;
    }

    /// The Paying Agent: burns at redemption, and pauses at a redemption.
    function payingAgent() internal pure returns (AgentRestrictions memory r) {
        r = none();
        r.disableBurn = false;
        r.disablePause = false;
    }

    /// The settlement contract: freezes and unfreezes part of a holding while an offer is open.
    function settlement() internal pure returns (AgentRestrictions memory r) {
        r = none();
        r.disablePartialFreeze = false;
    }

    /// The governance controller: notional amendments, register correction, the supervisory
    /// freeze and wallet recovery.
    function controller() internal pure returns (AgentRestrictions memory r) {
        r = none();
        r.disableMint = false;
        r.disableBurn = false;
        r.disableForceTransfer = false;
        r.disableAddressFreeze = false;
        r.disableRecovery = false;
    }

    /// Cancelling units from the Issuer's inventory: burning alone.
    function burnOnly() internal pure returns (AgentRestrictions memory r) {
        r = none();
        r.disableBurn = false;
    }

    function none() internal pure returns (AgentRestrictions memory) {
        return AgentRestrictions(true, true, true, true, true, true, true);
    }
}
