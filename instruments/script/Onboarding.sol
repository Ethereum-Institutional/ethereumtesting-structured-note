// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IIdentity} from "@onchain-id/solidity/contracts/interface/IIdentity.sol";
import {KeyPurposes} from "@onchain-id/solidity/contracts/libraries/KeyPurposes.sol";
import {KeyTypes} from "@onchain-id/solidity/contracts/libraries/KeyTypes.sol";
import {ExpiringClaimIssuer} from "../src/claims/ExpiringClaimIssuer.sol";
import {Scaffolding} from "./Scaffolding.sol";

/**
 * Onboarding by role (ADR 0088), as the deploy script and the tests do it. In operation each step
 * is a portal's: the bank's for the identity and the deposit claim, the onboarding agent's for the
 * note claim.
 *
 * 1. **The bank creates the client's identity** and manages it, as it manages every identity of
 *    its clients, and registers the client's wallet against it. The storage is shared, so every
 *    registry then knows the wallet.
 * 2. **The client consents** to an institution vouching for it: its identity gives that
 *    institution's key a claim key. The bank, as manager, records the consent.
 * 3. **The institution vouches**: its key signs a claim over the client's identity, a topic, and
 *    data carrying the claim's issue, its lapse, and the hash of the record kept off-chain, and
 *    adds it to the identity, naming its claim issuer, which the identity checks it against.
 *
 * Each function makes calls as whoever is broadcasting or pranking: the caller named in its notes.
 */
library Onboarding {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// Step 1. Called by the bank.
    function createIdentity(Scaffolding.Deployed memory d, address bank, address wallet, string memory salt)
        internal
        returns (IIdentity identity)
    {
        bytes32[] memory managers = new bytes32[](1);
        managers[0] = keccak256(abi.encode(bank));
        identity = IIdentity(d.idFactory.createIdentityWithManagementKeys(wallet, salt, managers));
        d.depositRegistry.registerIdentity(wallet, identity, Scaffolding.COUNTRY);
    }

    /// Step 2. Called by the identity's manager.
    function consent(IIdentity identity, address institution) internal {
        identity.addKey(keccak256(abi.encode(institution)), KeyPurposes.CLAIM_SIGNER, KeyTypes.ECDSA);
    }

    /// Step 3. Called by the institution, whose key `signerKey` signs the claim and holds a claim
    /// key on the identity.
    function vouch(
        ExpiringClaimIssuer issuer,
        uint256 signerKey,
        IIdentity identity,
        uint256 topic,
        uint48 validUntil,
        bytes32 recordHash
    ) internal returns (bytes memory signature) {
        bytes memory data = issuer.claimData(uint48(block.timestamp), validUntil, recordHash);
        signature = sign(signerKey, identity, topic, data);
        identity.addClaim(topic, 1, address(issuer), signature, data, "");
    }

    /// The signature an issuer's claim key gives a claim: over the identity, the topic and the
    /// data, as an Ethereum signed message.
    function sign(uint256 signerKey, IIdentity identity, uint256 topic, bytes memory data)
        internal
        pure
        returns (bytes memory)
    {
        bytes32 hash = keccak256(abi.encode(identity, topic, data));
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, prefixed);
        return abi.encodePacked(r, s, v);
    }
}
