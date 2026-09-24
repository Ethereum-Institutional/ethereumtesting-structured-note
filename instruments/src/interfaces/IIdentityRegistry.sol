// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;

/**
 * @title IIdentityRegistry
 * @notice The whitelist of record, read by every gate: the note's, the deposit's, the
 *         settlement path's and, from Wave 5, the conversion venue's.
 *
 * A grant records what an address may do, as rights and attribute flags, where it is
 * domiciled, which registrar onboarded it, and when it lapses. Nothing on the grant identifies
 * a person. The grant is written after a credential has been presented and verified off-chain;
 * the registry does not verify credentials and does not claim to.
 */
interface IIdentityRegistry {
    /// @dev The part of a grant a gate reads. One storage slot.
    struct Grant {
        uint32 flags;
        uint16 jurisdiction;
        uint16 registrar;
        uint40 grantedAt;
        uint40 expiresAt;
    }

    event RegistrarSet(address indexed issuingKey, uint16 indexed registrar);
    event MaxValiditySet(uint40 maxValidity);
    event Granted(
        address indexed account,
        uint16 indexed registrar,
        uint32 flags,
        uint16 jurisdiction,
        uint40 expiresAt,
        bytes32 credentialRef,
        bytes32 commitment
    );
    event Revoked(address indexed account, uint16 indexed registrar);

    error NotAnIssuingKey(address caller);
    error NotYourParticipant(address account, uint16 registrar);
    error ExpiryOutOfRange(uint40 expiresAt, uint40 latest);
    error NoGrant(address account);

    /// @notice The grant as recorded, whether or not it has lapsed.
    function grantOf(address account) external view returns (Grant memory);

    /// @notice The grant's flags while it is live; zero once it has lapsed or been revoked.
    function liveFlags(address account) external view returns (uint32 flags, uint16 jurisdiction);
}
