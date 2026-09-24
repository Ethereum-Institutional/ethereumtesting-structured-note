// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {ISnapshotEngine} from "debt-standard/interfaces/engine/ISnapshotEngine.sol";
import {IDeterminationAgent} from "./interfaces/IDeterminationAgent.sol";

interface IBalances {
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/**
 * @title RecordDateEngine
 * @notice The note's snapshot engine: every balance at every past instant, and the stop on
 *         transfers from a redemption Record Time.
 *
 * - **E1. Holder of record at the Record Time, inclusive.** The note calls this engine after
 *   every balance change. Each change is checkpointed at its block timestamp, and a later change
 *   in the same second replaces it, so the balance at time t is the balance after every
 *   transaction in a block stamped at or before t.
 * - **E4. Transfers stop at a redemption Record Time.** An ordinary transfer is refused from the
 *   Record Time of any date that could redeem the note, until a determination for that date shows
 *   it does not, and for good once it has. The stop needs no transaction to take effect. Mints and
 *   burns are unaffected, so the redemption itself proceeds. Forced transfers are ordinary
 *   transfers here and are stopped too.
 *
 * Bound to one note, which must have no supply when the engine is built, since earlier balances
 * would have no checkpoint.
 */
contract RecordDateEngine is ISnapshotEngine {
    struct Checkpoint {
        uint48 time;
        uint208 value;
    }

    IBalances public immutable NOTE;
    IDeterminationAgent public immutable DETERMINATIONS;

    mapping(address account => Checkpoint[]) private _balances;
    Checkpoint[] private _supply;

    error NotTheNote(address caller);
    error NoteHasSupply();
    error TransfersClosed();

    constructor(IBalances note, IDeterminationAgent determinations) {
        if (note.totalSupply() != 0) revert NoteHasSupply();
        NOTE = note;
        DETERMINATIONS = determinations;
    }

    /// @inheritdoc ISnapshotEngine
    function operateOnTransfer(address from, address to, uint256, uint256, uint256) external {
        if (msg.sender != address(NOTE)) revert NotTheNote(msg.sender);
        if (from != address(0) && to != address(0) && !DETERMINATIONS.transfersOpen()) revert TransfersClosed();
        if (from != address(0)) _push(_balances[from], NOTE.balanceOf(from));
        if (to != address(0)) _push(_balances[to], NOTE.balanceOf(to));
        if (from == address(0) || to == address(0)) _push(_supply, NOTE.totalSupply());
    }

    /// @notice The balance after every transaction in a block stamped at or before `time`.
    function balanceAt(address account, uint256 time) external view returns (uint256) {
        return _at(_balances[account], time);
    }

    /// @notice Total supply at `time`, on the same basis.
    function totalSupplyAt(uint256 time) external view returns (uint256) {
        return _at(_supply, time);
    }

    function _push(Checkpoint[] storage cps, uint256 value) private {
        uint48 now_ = uint48(block.timestamp);
        uint256 len = cps.length;
        if (len > 0 && cps[len - 1].time == now_) {
            cps[len - 1].value = uint208(value);
        } else {
            cps.push(Checkpoint(now_, uint208(value)));
        }
    }

    /// @dev The last checkpoint at or before `time`, by binary search; zero if there is none.
    function _at(Checkpoint[] storage cps, uint256 time) private view returns (uint256) {
        uint256 lo = 0;
        uint256 hi = cps.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (cps[mid].time > time) hi = mid;
            else lo = mid + 1;
        }
        return lo == 0 ? 0 : cps[lo - 1].value;
    }
}
