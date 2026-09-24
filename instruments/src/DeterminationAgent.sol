// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IDeterminationAgent} from "./interfaces/IDeterminationAgent.sol";

/**
 * @title DeterminationAgent
 * @notice Holds the note's terms, fixed at issuance, and accepts the Calculation Agent's signed
 *         determinations against them. The payoff lives here and nowhere else.
 *
 * Clause references are to docs/spikes/03-payoff-specification.md, which this contract
 * implements and which `spikes/payoff/model.py` implements a second time, independently.
 *
 * - **Terms and calendar are fixed at issuance** (P5) and validated, not repaired (P6). A
 *   determination supplies Levels for a scheduled date; never a date, a test or a barrier.
 * - **Two computations must agree** (D1). The Calculation Agent signs the Levels and the outcome
 *   it computed; this contract recomputes the outcome and accepts the determination only if the
 *   two are identical. A disagreement changes no state. The Levels stay on-chain, so any party
 *   can recompute the history.
 * - **Integers only** (section 9). Every test is a cross-multiplication and every amount a single
 *   quotient, rounded once per Calculation Amount, half a cent upward (R1, R2).
 * - **In order, once, until termination** (S1 to S3). Within a date: barrier, coupon, MER.
 * - **No disruption logic** (D3). A determination is accepted any time after its date.
 *
 * Nothing is upgradeable and nothing is settable after construction.
 */
contract DeterminationAgent is IDeterminationAgent, EIP712 {
    uint256 private constant B = 10_000;
    /// @dev Section 9: Levels below 2^96 keep every product below 2^200.
    uint256 private constant LEVEL_LIMIT = 1 << 96;

    bytes32 public constant DETERMINATION_TYPEHASH = keccak256(
        "Determination(uint256 dateIndex,bytes32 levelsHash,bool breached,bool couponPaid,uint64 couponPerCa,"
        "bool redeemed,uint64 redemptionPerCa,uint8 worstIndex)"
    );

    /// @notice The Calculation Agent's signing address; a contract account is supported.
    address public immutable CALCULATION_AGENT;

    Terms private _terms;
    mapping(uint256 dateIndex => Outcome) private _outcomes;
    mapping(uint256 dateIndex => uint256[]) private _levels;

    uint256 public nextDate;
    bool public terminated;
    uint256 public missedCoupons;
    bool public breached;

    constructor(Terms memory t, address calculationAgent) EIP712("DeterminationAgent", "1") {
        _validate(t);
        if (calculationAgent == address(0)) revert InvalidTerms("calculation agent");
        CALCULATION_AGENT = calculationAgent;
        _terms.initialLevels = t.initialLevels;
        _terms.calculationAmountCents = t.calculationAmountCents;
        _terms.couponBarrierBps = t.couponBarrierBps;
        _terms.couponRateBps = t.couponRateBps;
        _terms.memory_ = t.memory_;
        _terms.barrierBps = t.barrierBps;
        _terms.twinWin = t.twinWin;
        for (uint256 i = 0; i < t.schedule.length; ++i) {
            _terms.schedule.push(t.schedule[i]);
        }
    }

    // --- determinations ---

    /**
     * @notice Accepts the determination for the next scheduled date.
     * @param claimed The outcome the Calculation Agent computed and signed.
     * @param signature The Calculation Agent's EIP-712 signature over the Levels and `claimed`.
     */
    function determine(uint256 dateIndex, uint256[] calldata levels, Outcome calldata claimed, bytes calldata signature)
        external
    {
        if (terminated) revert Terminated();
        if (dateIndex != nextDate) revert NotNextDate(dateIndex, nextDate);
        Observation memory o = _terms.schedule[dateIndex];
        if (block.timestamp < o.date) revert BeforeScheduledDate(dateIndex, o.date);

        (Outcome memory computed, uint256 missedAfter) = compute(dateIndex, levels);
        if (keccak256(abi.encode(computed)) != keccak256(abi.encode(claimed))) revert OutcomeDisagrees(computed);
        if (!SignatureChecker.isValidSignatureNow(CALCULATION_AGENT, digest(dateIndex, levels, claimed), signature)) {
            revert BadSignature();
        }

        _outcomes[dateIndex] = computed;
        _levels[dateIndex] = levels;
        nextDate = dateIndex + 1;
        missedCoupons = missedAfter;
        breached = computed.breached;
        if (computed.redeemed) terminated = true;
        emit Determined(dateIndex, levels, computed);
    }

    /// @notice The EIP-712 digest the Calculation Agent signs.
    function digest(uint256 dateIndex, uint256[] calldata levels, Outcome calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    DETERMINATION_TYPEHASH,
                    dateIndex,
                    keccak256(abi.encodePacked(levels)),
                    o.breached,
                    o.couponPaid,
                    o.couponPerCa,
                    o.redeemed,
                    o.redemptionPerCa,
                    o.worstIndex
                )
            )
        );
    }

    /**
     * @notice The outcome this contract computes for the next date from `levels`, with the coupon
     *         count carried forward. Reads state; changes none.
     */
    function compute(uint256 dateIndex, uint256[] calldata levels)
        public
        view
        returns (Outcome memory out, uint256 missedAfter)
    {
        Terms storage t = _terms;
        uint256 n = t.initialLevels.length;
        if (levels.length != n) revert InvalidLevels();
        for (uint256 k = 0; k < n; ++k) {
            if (levels[k] >= LEVEL_LIMIT) revert InvalidLevels();
        }
        Observation memory o = t.schedule[dateIndex];

        // P4: lowest Ratio, by cross-multiplication; on a tie the lowest index.
        uint256 w = 0;
        for (uint256 k = 1; k < n; ++k) {
            if (levels[k] * t.initialLevels[w] < levels[w] * t.initialLevels[k]) w = k;
        }
        uint256 f = levels[w];
        uint256 i = t.initialLevels[w];
        out.worstIndex = uint8(w);
        uint256 ca = t.calculationAmountCents;
        missedAfter = missedCoupons;

        // S2: barrier, then coupon, then MER. B3: a breach is strictly below.
        out.breached = breached || (o.barrier && f * B < t.barrierBps * i);

        if (o.coupon) {
            if (f * B >= t.couponBarrierBps * i) {
                // B1 inclusive. P8: with memory, the consecutive missed coupons are paid too.
                uint256 periods = 1 + (t.memory_ ? missedAfter : 0);
                out.couponPaid = true;
                out.couponPerCa = uint64(_round(ca * t.couponRateBps * periods, B));
                missedAfter = 0;
            } else {
                missedAfter += 1;
            }
        }

        if (o.mer && f * B >= o.merTriggerBps * i) {
            // B2 inclusive. S2: CA, with that date's coupon paid separately above.
            out.redeemed = true;
            out.redemptionPerCa = uint64(ca);
        } else if (o.isFinal) {
            out.redeemed = true;
            out.redemptionPerCa = uint64(_finalRedemption(t, ca, f, i, out.breached));
        }
    }

    // --- reads ---

    function observationCount() external view returns (uint256) {
        return _terms.schedule.length;
    }

    function observation(uint256 dateIndex) external view returns (Observation memory) {
        return _terms.schedule[dateIndex];
    }

    function terms() external view returns (Terms memory) {
        return _terms;
    }

    function calculationAmountCents() external view returns (uint64) {
        return _terms.calculationAmountCents;
    }

    function determined(uint256 dateIndex) external view returns (bool) {
        return dateIndex < nextDate;
    }

    function outcomeOf(uint256 dateIndex) external view returns (Outcome memory) {
        return _outcomes[dateIndex];
    }

    function levelsOf(uint256 dateIndex) external view returns (uint256[] memory) {
        return _levels[dateIndex];
    }

    /// @inheritdoc IDeterminationAgent
    function transfersOpen() external view returns (bool) {
        if (terminated) return false;
        Observation[] storage s = _terms.schedule;
        for (uint256 k = nextDate; k < s.length; ++k) {
            if (s[k].mer || s[k].isFinal) return block.timestamp <= s[k].recordTime;
        }
        return true;
    }

    // --- internal ---

    /// @dev P7, per Calculation Amount, in cents.
    function _finalRedemption(Terms storage t, uint256 ca, uint256 f, uint256 i, bool wasBreached)
        private
        view
        returns (uint256)
    {
        if (wasBreached && f < i) return _round(ca * f, i); // Scenario B: CA x final Ratio
        TwinWin memory tw = t.twinWin;
        if (!tw.applies) return ca; // Scenario A
        uint256 num = f >= i ? ca * (B * i + tw.upBps * (f - i)) : ca * (B * i + tw.downBps * (i - f));
        uint256 den = B * i;
        // The cap is compared before rounding.
        if (tw.capBps != 0 && num * B > ca * tw.capBps * den) return _round(ca * tw.capBps, B);
        return _round(num, den);
    }

    /// @dev R2: nearest, half upward. (2n + d) / 2d.
    function _round(uint256 num, uint256 den) private pure returns (uint256) {
        return (2 * num + den) / (2 * den);
    }

    /// @dev P6. Invalid terms are rejected, not repaired.
    function _validate(Terms memory t) private pure {
        if (t.initialLevels.length == 0 || t.initialLevels.length > 255) revert InvalidTerms("basket size");
        for (uint256 k = 0; k < t.initialLevels.length; ++k) {
            if (t.initialLevels[k] == 0 || t.initialLevels[k] >= LEVEL_LIMIT) revert InvalidTerms("initial level");
        }
        if (t.calculationAmountCents == 0) revert InvalidTerms("calculation amount");
        if (t.barrierBps == 0 || t.barrierBps > B) revert InvalidTerms("barrier");
        if (t.barrierBps > t.couponBarrierBps) revert InvalidTerms("barrier above coupon barrier");
        uint256 len = t.schedule.length;
        if (len == 0) revert InvalidTerms("empty schedule");
        for (uint256 k = 0; k < len; ++k) {
            Observation memory o = t.schedule[k];
            if (k > 0 && o.date <= t.schedule[k - 1].date) revert InvalidTerms("schedule not strictly ordered");
            if (o.recordTime < o.date || o.paymentDate < o.recordTime) revert InvalidTerms("record or payment time");
            if (o.isFinal != (k == len - 1)) revert InvalidTerms("exactly one final date, last");
            if (o.mer && (o.isFinal || o.merTriggerBps < t.couponBarrierBps)) revert InvalidTerms("MER trigger");
        }
        if (!t.schedule[len - 1].barrier) revert InvalidTerms("barrier always observed on the final date");
        if (t.twinWin.applies && t.twinWin.capBps != 0 && t.twinWin.capBps < B) revert InvalidTerms("twin win cap");
    }
}
