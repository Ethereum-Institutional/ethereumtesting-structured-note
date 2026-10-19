// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;

/**
 * @title IProgrammeRoles
 * @notice Who holds each of the programme's roles now, as the governance controller records them.
 *         Every note's lifecycle contracts read their roles here rather than holding their own, so
 *         a role is rotated once for the whole book, by one Tier 2 act.
 */
interface IProgrammeRoles {
    /// @notice The governance controller itself: the only caller of a note's governed acts.
    function governance() external view returns (address);
    /// @notice The Agent's servicing wallet: opens and pays distributions.
    function servicingWallet() external view returns (address);
    /// @notice Whose signature a determination must carry; a contract account is supported.
    function calculationAgent() external view returns (address);
    /// @notice The deposit account every distribution is drawn from: the Agent's.
    function funder() external view returns (address);
}
