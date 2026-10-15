// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";

/// ONCHAINID and T-REX, as far as admitting a wallet to the pool needs them. They are in the other
/// compilation unit; the scripts and the venue tests reach them over ABI.
interface IClaimHolder {
    function addClaim(
        uint256 topic,
        uint256 scheme,
        address issuer,
        bytes memory signature,
        bytes memory data,
        string memory uri
    ) external returns (bytes32);
}

interface IIdentityStorage {
    function storedIdentity(address wallet) external view returns (address);
}

/**
 * The bank's pool-access claim (ADR 0090), as the deploy scripts and the venue tests write it,
 * standing in for the verification that precedes it in operation: the bank has found its client a
 * professional or institutional investor, and screened it.
 *
 * The claim is the same shape as every claim of the deployment (ADR 0088): its data carries the
 * claim's issue, its lapse and the hash of the record kept off-chain; the bank's key
 * signs it over the identity, the topic and the data; and it is added to the identity under the
 * bank's claim key, which the client's consent gave it.
 *
 * {admit} calls the identity as whoever is broadcasting or pranking: the bank.
 */
library PoolAccess {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @dev keccak256("claim.pool-access"), as instruments/src/claims/ClaimTopics.sol defines it.
    uint256 internal constant TOPIC = uint256(keccak256("claim.pool-access"));
    /// @dev The longest the pool accepts between screenings, before a claim must be renewed.
    uint48 internal constant VALIDITY = 90 days;

    /// The identity registered for `wallet` in the deployment's identity storage, or zero.
    function identityOf(string memory manifest, address wallet) internal view returns (address) {
        return IIdentityStorage(vm.parseJsonAddress(manifest, ".identity.identityStorage")).storedIdentity(wallet);
    }

    /// The bank, whose key is `bankKey`, vouches that `wallet` may use the pool.
    function admit(string memory manifest, uint256 bankKey, address wallet) internal returns (address identity) {
        identity = identityOf(manifest, wallet);
        require(identity != address(0), "no identity registered for the wallet");
        address issuer = vm.parseJsonAddress(manifest, ".identity.bankIssuer");
        bytes memory data = abi.encode(
            uint48(block.timestamp),
            uint48(block.timestamp) + VALIDITY,
            keccak256(abi.encode(wallet, TOPIC, "verified record"))
        );
        bytes32 hash = keccak256(abi.encode(identity, TOPIC, data));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(bankKey, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)));
        IClaimHolder(identity).addClaim(TOPIC, 1, issuer, abi.encodePacked(r, s, v), data, "");
    }
}
