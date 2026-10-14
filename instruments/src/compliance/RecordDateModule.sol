// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {IERC3643Compliance} from "t-rex/ERC-3643/IERC3643Compliance.sol";
import {IModule} from "t-rex/compliance/modular/modules/IModule.sol";
import {IDeterminationAgent} from "../interfaces/IDeterminationAgent.sol";

interface IBalances {
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/**
 * @title RecordDateModule
 * @notice The note's record dates as an ERC-3643 compliance module (ADR 0088): every balance at
 *         every past instant, and the stop on transfers from a redemption Record Time. It takes
 *         the place of the snapshot engine the note had on the debt standard, with the same rules.
 *
 * - **E1. Holder of record at the Record Time, inclusive.** The token's compliance calls this
 *   module after every mint, burn and transfer. Each change is checkpointed at its block
 *   timestamp, and a later change in the same second replaces it, so the balance at time t is the
 *   balance after every transaction in a block stamped at or before t.
 * - **E4. Transfers stop at a redemption Record Time.** A transfer is refused from the Record
 *   Time of any date that could redeem the note, until a determination for that date shows it
 *   does not, and for good once it has. Ordinary transfers are refused by the compliance check
 *   before they move. A forced transfer skips that check, so it is refused here, after the move,
 *   which undoes it. Mints and burns are unaffected, so the redemption itself proceeds.
 * - **Recovery** of a lost wallet moves units without calling compliance, so it leaves no
 *   checkpoint. {sync} records the accounts' balances as they are now; the governance controller
 *   calls it in the same transaction as a recovery. Anyone may call it, since it records only
 *   what is true.
 *
 * One module for one note: it binds to the first compliance that binds it, and to that
 * compliance's token, and to no other. Not upgradeable.
 *
 * Licensed GPL-3.0 because it implements T-REX's module interface (ADR 0087).
 */
contract RecordDateModule is IModule {
    struct Checkpoint {
        uint48 time;
        uint208 value;
    }

    IDeterminationAgent public immutable DETERMINATIONS;

    /// @notice The compliance this module is bound to.
    address public compliance;
    IBalances private _token;
    bool private _bound;

    mapping(address account => Checkpoint[]) private _balances;
    Checkpoint[] private _supply;

    event ComplianceBound(address indexed compliance);
    event ComplianceUnbound(address indexed compliance);

    error NotTheCompliance(address caller);
    error AlreadyBound(address compliance);
    error TransfersClosed();

    constructor(IDeterminationAgent determinations) {
        DETERMINATIONS = determinations;
    }

    // --- binding ---

    /// @inheritdoc IModule
    function bindCompliance(address c) external {
        if (compliance != address(0)) revert AlreadyBound(compliance);
        if (msg.sender != c) revert NotTheCompliance(msg.sender);
        // The compliance may be binding from its own constructor, before it can be asked for its
        // token, so the token is resolved on first use.
        compliance = c;
        _bound = true;
        emit ComplianceBound(c);
    }

    /// @inheritdoc IModule
    function unbindCompliance(address c) external {
        if (msg.sender != compliance || c != compliance) revert NotTheCompliance(msg.sender);
        _bound = false;
        emit ComplianceUnbound(c);
    }

    /// @inheritdoc IModule
    function isComplianceBound(address c) external view returns (bool) {
        return _bound && c == compliance;
    }

    /// @inheritdoc IModule
    function canComplianceBind(address) external view returns (bool) {
        return compliance == address(0);
    }

    /// @inheritdoc IModule
    function isPlugAndPlay() external pure returns (bool) {
        return false;
    }

    /// @inheritdoc IModule
    function name() external pure returns (string memory) {
        return "RecordDateModule";
    }

    // --- the token's compliance ---

    /// @inheritdoc IModule
    function moduleCheck(address from, address to, uint256, address c) external view returns (bool) {
        if (c != compliance) return false;
        if (from == address(0) || to == address(0)) return true;
        return DETERMINATIONS.transfersOpen();
    }

    /// @inheritdoc IModule
    function moduleTransferAction(address from, address to, uint256) external {
        _onlyCompliance();
        if (!DETERMINATIONS.transfersOpen()) revert TransfersClosed();
        IBalances n = _note();
        _push(_balances[from], n.balanceOf(from));
        _push(_balances[to], n.balanceOf(to));
    }

    /// @inheritdoc IModule
    function moduleMintAction(address to, uint256) external {
        _onlyCompliance();
        IBalances n = _note();
        _push(_balances[to], n.balanceOf(to));
        _push(_supply, n.totalSupply());
    }

    /// @inheritdoc IModule
    function moduleBurnAction(address from, uint256) external {
        _onlyCompliance();
        IBalances n = _note();
        _push(_balances[from], n.balanceOf(from));
        _push(_supply, n.totalSupply());
    }

    // --- recovery ---

    /// @notice Records the accounts' balances as they are now, after a move that bypassed compliance.
    function sync(address[] calldata accounts) external {
        IBalances n = _note();
        for (uint256 k = 0; k < accounts.length; ++k) {
            _push(_balances[accounts[k]], n.balanceOf(accounts[k]));
        }
    }

    // --- reads ---

    /// @notice The note this module keeps the record dates of.
    function note() external view returns (address) {
        return IERC3643Compliance(compliance).getTokenBound();
    }

    /// @notice Whether an ordinary transfer may settle now (E4).
    function transfersOpen() external view returns (bool) {
        return DETERMINATIONS.transfersOpen();
    }

    /// @notice The balance after every transaction in a block stamped at or before `time`.
    function balanceAt(address account, uint256 time) external view returns (uint256) {
        return _at(_balances[account], time);
    }

    /// @notice Total supply at `time`, on the same basis.
    function totalSupplyAt(uint256 time) external view returns (uint256) {
        return _at(_supply, time);
    }

    // --- internal ---

    function _onlyCompliance() private view {
        if (msg.sender != compliance || !_bound) revert NotTheCompliance(msg.sender);
    }

    function _note() private returns (IBalances n) {
        n = _token;
        if (address(n) == address(0)) {
            n = IBalances(IERC3643Compliance(compliance).getTokenBound());
            _token = n;
        }
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
