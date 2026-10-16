// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;

import {AgentRestrictions} from "../interfaces/INote.sol";

/**
 * Each agent's powers on a note, as restrictions T-REX applies (ADR 0085): every power off, then
 * those the agent needs on. A note has three agents, all set by the factory at issuance: its own
 * Paying Agent and settlement contract, and the programme's governance controller.
 */
library AgentPowers {
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

    /// The governance controller, the only other agent (ADR 0115): notional amendments and
    /// cancelling the Issuer's inventory, register correction, the supervisory freeze, wallet
    /// recovery, and pausing on the servicing wallet's word.
    function controller() internal pure returns (AgentRestrictions memory r) {
        r = none();
        r.disableMint = false;
        r.disableBurn = false;
        r.disableForceTransfer = false;
        r.disableAddressFreeze = false;
        r.disableRecovery = false;
        r.disablePause = false;
    }

    function none() internal pure returns (AgentRestrictions memory) {
        return AgentRestrictions(true, true, true, true, true, true, true);
    }
}
