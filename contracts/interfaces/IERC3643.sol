// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @dev Minimal, locally-declared views onto the ERC-3643 (T-REX) issuer stack.
 *
 * T-REX v4.1.6 pins `solidity 0.8.17` and OpenZeppelin v4, while the Uniswap v4
 * venue contracts require `0.8.26` and OpenZeppelin v5. Rather than force the two
 * into one compilation unit, the venue side declares only the call surface it
 * needs and talks to the deployed issuer stack over ABI -- which mirrors how this
 * separates in production: the issuer deploys T-REX, the venue deploys pool infra.
 */

/// @dev ERC-3643 identity registry: binds wallets to ONCHAINIDs and verifies claims.
interface IERC3643IdentityRegistry {
    /// @dev True if the wallet is registered AND its ONCHAINID holds every required
    /// claim topic, each signed by a currently-trusted issuer.
    function isVerified(address userAddress) external view returns (bool);

    /// @dev True if the wallet is registered at all (may still fail `isVerified`).
    function contains(address userAddress) external view returns (bool);

    /// @dev The ONCHAINID contract bound to this wallet.
    function identity(address userAddress) external view returns (address);

    /// @dev ISO-3166 numeric country code recorded for the investor.
    function investorCountry(address userAddress) external view returns (uint16);
}

/// @dev ERC-3643 permissioned token.
interface IERC3643Token {
    function identityRegistry() external view returns (address);
    function compliance() external view returns (address);
    /// @dev Whole-wallet freeze set by an agent.
    function isFrozen(address userAddress) external view returns (bool);
    /// @dev Partial freeze: amount of this holder's balance immobilised.
    function getFrozenTokens(address userAddress) external view returns (uint256);
    function paused() external view returns (bool);
}

/// @dev ERC-735 claim holder (ONCHAINID).
interface IOnchainIdentity {
    function getClaimIdsByTopic(uint256 topic) external view returns (bytes32[] memory);
}
