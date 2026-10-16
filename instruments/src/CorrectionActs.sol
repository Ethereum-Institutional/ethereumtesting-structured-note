// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.30;

import {IDeterminationAgent} from "./interfaces/IDeterminationAgent.sol";

interface ICorrectingPayingAgent {
    function idOf(uint256 dateIndex, uint8 kind) external pure returns (bytes32);
    function distributions(bytes32 id)
        external
        view
        returns (uint48, uint64, uint64, uint64, bool, bool, uint8, bool, uint64, uint256);
    function reverse(bytes32 id, address[] calldata holders, string calldata reason) external;
    function restate(bytes32 original, uint48 recordTime, string calldata reason) external returns (bytes32);
}

interface ICorrectable {
    function correct(
        uint256 dateIndex,
        uint256[] calldata levels,
        IDeterminationAgent.Outcome calldata claimed,
        bytes calldata signature
    ) external;
}

/**
 * @title CorrectionActs
 * @notice The governance controller's Tier 2 correction of a determination (ADR 0115), kept in a
 *         library of its own so that the controller stays under the contract size limit. Called by
 *         delegatecall, so every downstream call is the controller's own.
 *
 * The note's Determination Agent replaces its latest determination with the Levels the Calculation
 * Agent signed again. Where that date's coupon was already paid, the same act reverses it for the
 * holders of record given, each against its original credit, and restates it at the corrected
 * amount at the same Record Time; where the corrected outcome pays no coupon, the reversal stands
 * alone. A coupon still being paid is refused until it closes, and a redemption once opened is
 * refused outright: its units are already being burned.
 */
library CorrectionActs {
    uint8 private constant COUPON = 0;
    uint8 private constant REDEMPTION = 1;

    /// @notice A correction as proposed: the Levels and outcome the Calculation Agent signed, and
    ///         the holders of record to reverse where the coupon was paid.
    struct Correction {
        address token;
        uint256 dateIndex;
        uint256[] levels;
        IDeterminationAgent.Outcome outcome;
        bytes signature;
        address[] holders;
    }

    error RedemptionUnderway(address token, uint256 dateIndex);
    error CouponNotClosed(address token, uint256 dateIndex);

    function correct(Correction memory c, address determinations, address payingAgent, string memory reason) external {
        ICorrectingPayingAgent pa = ICorrectingPayingAgent(payingAgent);
        (,,,, bool redemptionOpen,,,,,) = pa.distributions(pa.idOf(c.dateIndex, REDEMPTION));
        if (redemptionOpen) revert RedemptionUnderway(c.token, c.dateIndex);
        bytes32 coupon = pa.idOf(c.dateIndex, COUPON);
        (uint48 recordTime,,,, bool couponOpen, bool couponClosed,,,,) = pa.distributions(coupon);
        if (couponOpen && !couponClosed) revert CouponNotClosed(c.token, c.dateIndex);

        ICorrectable(determinations).correct(c.dateIndex, c.levels, c.outcome, c.signature);
        if (couponClosed) {
            pa.reverse(coupon, c.holders, reason);
            if (c.outcome.couponPaid) pa.restate(coupon, recordTime, reason);
        }
    }
}
