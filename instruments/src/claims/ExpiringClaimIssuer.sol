// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {IClaimIssuer} from "@onchain-id/solidity/contracts/interface/IClaimIssuer.sol";
import {IERC735} from "@onchain-id/solidity/contracts/interface/IERC735.sol";
import {IIdentity, Identity} from "@onchain-id/solidity/contracts/Identity.sol";
import {Errors} from "@onchain-id/solidity/contracts/libraries/Errors.sol";
import {KeyPurposes} from "@onchain-id/solidity/contracts/libraries/KeyPurposes.sol";

/**
 * @title ExpiringClaimIssuer
 * @notice An ONCHAINID claim issuer whose claims lapse (ADR 0088). One per institution that
 *         vouches for a client: the bank for its deposit, an onboarding agent for the note.
 *
 * ONCHAINID 2.x has no expiry, and its own claim issuer's validity check cannot be overridden,
 * so this is a claim issuer of its own, built on ONCHAINID's Identity as that one is. A trusted
 * issuer is any contract implementing {IClaimIssuer}, so T-REX's identity registries accept it
 * unchanged.
 *
 * - **What a claim carries.** Its data is `abi.encode(uint48 issuedAt, uint48 validUntil,
 *   bytes32 recordHash)`: when it was issued, when it lapses, and a salted hash of the verified
 *   record the institution keeps off-chain. Nothing on-chain identifies the client.
 * - **Valid** while signed by one of this issuer's claim keys, not revoked, issued no later than
 *   now, not yet lapsed, and running no longer than `maxValidity`. A lapsed claim needs no
 *   transaction: the registry's next check fails.
 * - **Revocable at once,** by signature or by claim, by a management key, as in ONCHAINID.
 * - **Not upgradeable.** A changed rule means a new issuer, which the token's governance then
 *   trusts in place of this one.
 *
 * Licensed GPL-3.0 because it is built on ONCHAINID's Identity (ADR 0087).
 */
contract ExpiringClaimIssuer is IClaimIssuer, Identity {
    /// @notice The longest a claim may run, from its issue to its lapse.
    uint48 public maxValidity;

    mapping(bytes signature => bool) public revokedClaims;

    event MaxValiditySet(uint48 maxValidity);

    error ValidityOutOfRange();

    constructor(address initialManagementKey, uint48 maxValidity_) Identity(initialManagementKey, false) {
        _setMaxValidity(maxValidity_);
    }

    /// @notice The longest a claim may run. Shortening it lapses longer claims already issued.
    function setMaxValidity(uint48 maxValidity_) external delegatedOnly onlyManager {
        _setMaxValidity(maxValidity_);
    }

    // --- claims ---

    /// @notice The claim data this issuer signs, for a client's off-chain record.
    function claimData(uint48 issuedAt, uint48 validUntil, bytes32 recordHash) external pure returns (bytes memory) {
        return abi.encode(issuedAt, validUntil, recordHash);
    }

    /// @notice When a claim's data says it was issued and lapses; zero for data not in this form.
    function termsOf(bytes memory data) public pure returns (uint48 issuedAt, uint48 validUntil, bytes32 recordHash) {
        if (data.length != 96) return (0, 0, 0);
        return abi.decode(data, (uint48, uint48, bytes32));
    }

    /// @inheritdoc IClaimIssuer
    function isClaimValid(IIdentity identity, uint256 claimTopic, bytes memory sig, bytes memory data)
        public
        view
        override(Identity, IClaimIssuer)
        returns (bool)
    {
        (uint48 issuedAt, uint48 validUntil,) = termsOf(data);
        if (validUntil == 0 || issuedAt > block.timestamp || block.timestamp >= validUntil) return false;
        if (validUntil - issuedAt > maxValidity) return false;

        bytes32 dataHash = keccak256(abi.encode(identity, claimTopic, data));
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash));
        address signer = getRecoveredAddress(sig, prefixed);
        return keyHasPurpose(keccak256(abi.encode(signer)), KeyPurposes.CLAIM_SIGNER) && !revokedClaims[sig];
    }

    /// @inheritdoc IClaimIssuer
    function isClaimRevoked(bytes calldata sig) external view override returns (bool) {
        return revokedClaims[sig];
    }

    /// @inheritdoc IClaimIssuer
    function revokeClaimBySignature(bytes calldata signature) external override delegatedOnly onlyManager {
        require(!revokedClaims[signature], Errors.ClaimAlreadyRevoked());
        revokedClaims[signature] = true;
        emit ClaimRevoked(signature);
    }

    /// @inheritdoc IClaimIssuer
    function revokeClaim(bytes32 claimId, address identity)
        external
        override
        delegatedOnly
        onlyManager
        returns (bool)
    {
        (,,, bytes memory sig,,) = Identity(identity).getClaim(claimId);
        require(!revokedClaims[sig], Errors.ClaimAlreadyRevoked());
        revokedClaims[sig] = true;
        emit ClaimRevoked(sig);
        return true;
    }

    /**
     * @inheritdoc IClaimIssuer
     * @dev ONCHAINID approves this only for an issuer that holds a management key on the
     *      identity. Clients here give the institution's own key a claim key instead, and the
     *      institution adds its claim to the identity directly (ADR 0088).
     */
    function addClaimTo(
        uint256 topic,
        uint256 scheme,
        bytes calldata signature,
        bytes calldata data,
        string calldata uri,
        IIdentity identity
    ) external override delegatedOnly onlyManager {
        require(isClaimValid(identity, topic, signature, data), Errors.InvalidClaim());
        bytes memory add =
            abi.encodeCall(IERC735.addClaim, (topic, scheme, address(this), signature, data, uri));
        uint256 id = identity.execute(address(identity), 0, add);
        require(Identity(address(identity)).getExecutionData(id).executed, Errors.CallFailed());
        emit ClaimAddedTo(address(identity), topic, signature, data);
    }

    function _setMaxValidity(uint48 maxValidity_) private {
        if (maxValidity_ == 0) revert ValidityOutOfRange();
        maxValidity = maxValidity_;
        emit MaxValiditySet(maxValidity_);
    }
}
