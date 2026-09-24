// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;

/**
 * @title IDeterminationAgent
 * @notice The note's terms, fixed at issuance, and the determinations accepted against them.
 *         Clause references are to docs/spikes/03-payoff-specification.md.
 */
interface IDeterminationAgent {
    /// @dev One scheduled date and the tests that apply on it (P5). Times are Unix seconds.
    struct Observation {
        uint48 date;
        uint48 recordTime;
        uint48 paymentDate;
        bool coupon;
        bool mer;
        bool barrier;
        bool isFinal;
        uint32 merTriggerBps;
    }

    struct TwinWin {
        bool applies;
        uint32 upBps;
        uint32 downBps;
        /// @dev Cap on the redemption, as bps of the Calculation Amount; zero for none.
        uint32 capBps;
    }

    struct Terms {
        uint256[] initialLevels;
        uint64 calculationAmountCents;
        uint32 couponBarrierBps;
        uint32 couponRateBps;
        bool memory_;
        uint32 barrierBps;
        TwinWin twinWin;
        Observation[] schedule;
    }

    /// @dev What a determination establishes for one date. `breached` is cumulative.
    struct Outcome {
        bool breached;
        bool couponPaid;
        uint64 couponPerCa;
        bool redeemed;
        uint64 redemptionPerCa;
        uint8 worstIndex;
    }

    event Determined(uint256 indexed dateIndex, uint256[] levels, Outcome outcome);

    error InvalidTerms(string reason);
    error NotNextDate(uint256 dateIndex, uint256 next);
    error BeforeScheduledDate(uint256 dateIndex, uint48 date);
    error Terminated();
    error InvalidLevels();
    error OutcomeDisagrees(Outcome computed);
    error BadSignature();

    function observationCount() external view returns (uint256);
    function observation(uint256 dateIndex) external view returns (Observation memory);
    function calculationAmountCents() external view returns (uint64);
    function determined(uint256 dateIndex) external view returns (bool);
    function outcomeOf(uint256 dateIndex) external view returns (Outcome memory);
    function terminated() external view returns (bool);

    /// @notice False from the Record Time of any date that could redeem until its determination
    ///         shows it does not, and for good once the note has redeemed (E4).
    function transfersOpen() external view returns (bool);
}
