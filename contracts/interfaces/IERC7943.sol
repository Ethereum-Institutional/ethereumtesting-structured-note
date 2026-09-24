// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @dev The views of ERC-7943 (uRWA), fungible form, as published with status Final, that the
 *      venue reads. The enforcement functions are not declared: the venue never calls them.
 *
 * `paused()` is not part of the interface. Instruments built on the debt standard expose it,
 * and the checker reads it where it exists.
 */
interface IERC7943FungibleViews {
    /// @dev True if the account may send tokens under the token's own rules.
    function canSend(address account) external view returns (bool allowed);
    /// @dev True if the account may receive tokens under the token's own rules.
    function canReceive(address account) external view returns (bool allowed);
    /// @dev Amount of the account's tokens that are frozen. May exceed its balance.
    function getFrozenTokens(address account) external view returns (uint256 amount);
    function balanceOf(address account) external view returns (uint256);
}

interface IPausable {
    function paused() external view returns (bool);
}
