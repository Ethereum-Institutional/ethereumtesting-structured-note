// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @title DemoBaseline
 * @notice Records which chain snapshot the demo should return to.
 *
 * The console is stateless -- it runs as serverless functions and keeps nothing between
 * requests -- so the "reset the demo" button has nowhere of its own to remember the snapshot
 * it should revert to. It stores that here instead, on the chain the snapshot belongs to.
 *
 * Anvil snapshot ids are consumed by `evm_revert` and never reissued, so the id has to be
 * refreshed after every reset. The console does that in the same action: revert, take a fresh
 * snapshot, write the new id here.
 *
 * If the stored id is stale -- which happens on a hosted chain, because snapshots do not
 * survive the state dump the node boots from -- `evm_revert` simply returns false and the
 * console arms a new baseline at the current state instead.
 */
contract DemoBaseline {
    /// @notice Anvil snapshot id the demo resets to.
    /// @dev Valid ids start at zero, so a separate flag is needed -- an id of 0 is a real,
    ///      revertable snapshot and must not read as "nothing armed".
    uint256 public snapshotId;

    /// @notice Whether {snapshotId} holds a baseline at all.
    bool public armed;

    /// @notice Unix time the baseline was armed, for display.
    uint256 public armedAt;

    /// @notice Who may arm the baseline.
    address public immutable OPERATOR;

    event BaselineArmed(uint256 snapshotId, uint256 armedAt);

    error NotOperator(address caller);

    constructor(address operator) {
        OPERATOR = operator;
    }

    function arm(uint256 newSnapshotId, uint256 timestamp) external {
        if (msg.sender != OPERATOR) revert NotOperator(msg.sender);
        snapshotId = newSnapshotId;
        armedAt = timestamp;
        armed = true;
        emit BaselineArmed(newSnapshotId, timestamp);
    }

    function isArmed() external view returns (bool) {
        return armed;
    }
}
