// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice The two reads the pool's credential gate makes of the credential protocol's on-chain
 *         registries. Issuers are keyed by their decentralised identifier string.
 *
 * The protocol verifies credential signatures off-chain; on-chain it records only which issuers
 * are active and which credentials are revoked (ADR 0028).
 */
interface ICredentialIssuers {
    /// @notice True while the issuer is registered and not deactivated.
    function isActive(string calldata did) external view returns (bool);
}

interface ICredentialRevocations {
    /// @notice True once the issuer has revoked the credential.
    function isRevoked(string calldata did, bytes32 credentialId) external view returns (bool);

    /// @notice The issuer's most recently published revocation root.
    function currentRoot(string calldata did) external view returns (bytes32);

    /// @notice True if `root` was current for the issuer within the last `windowSec` seconds.
    function isRootRecent(string calldata did, bytes32 root, uint256 windowSec) external view returns (bool);
}
