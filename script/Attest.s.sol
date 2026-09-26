// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {PoolCredentialRegistry} from "../contracts/PoolCredentialRegistry.sol";
import {Manifest} from "./Manifest.sol";

interface IIdentityRegistryWriter {
    function HOLD() external view returns (uint32);
    function RECEIVE() external view returns (uint32);
    function TRANSFER() external view returns (uint32);
    function SANCTIONS_CLEAR() external view returns (uint32);
    function CONTRACT_ACCOUNT() external view returns (uint32);
    function PROFESSIONAL() external view returns (uint32);
    function grant(address account, uint32 flags, uint16 jurisdiction, uint40 expiresAt, bytes32 ref, bytes32 commitment)
        external;
}

/**
 * The Access Issuer's attestation of one entity from a presentation the credential protocol's
 * verifier has already verified (ADRs 0030, 0033, 0042 to 0044).
 *
 *   ATTESTATION_FILE=ops/attestations/<name>.json forge script script/Attest.s.sol --rpc-url ... --broadcast
 *
 * The file is the verifier's result, in the shape of ops/attestations/example.json. This script
 * makes the Access Issuer's own checks, off-chain, before anything is written: a GRANT verdict,
 * the configured issuer for every credential (ADR 0052), the wallet credential issued to the presenting officer, the officer acting
 * for the corporation the corporate identity names, and, for a contract wallet, a signature
 * verified on this chain (ADRs 0042, 0046, 0050). It then writes, from
 * the one presentation, the pool grant and the Identity Registry grant (ADR 0044). The gate checks
 * the rest on-chain: issuer active, no credential revoked, and the policy.
 *
 * It does not verify credential signatures. That is the verifier's, against issuer keys pinned in
 * its trust configuration (ADR 0042).
 */
contract Attest is Script {
    uint40 constant REGISTRY_VALIDITY = 180 days;

    struct Presentation {
        bytes32 corporateCid;
        bytes32 walletCid;
        bytes32 officerCid;
        bytes32 corporateSchema;
        bytes32 evidence;
        address wallet;
        bool contractWallet;
        bytes2 jurisdiction;
        uint8 investorClass;
        uint40 issuedAt;
        uint40 expiresAt;
        uint32 checks;
    }

    function run() external {
        string memory j = Manifest.read();
        PoolCredentialRegistry gate = PoolCredentialRegistry(vm.parseJsonAddress(j, ".venue.credentialGate"));
        Presentation memory p = _read(vm.readFile(vm.envString("ATTESTATION_FILE")), gate);

        PoolCredentialRegistry.Attestation memory a = PoolCredentialRegistry.Attestation({
            account: p.wallet,
            path: PoolCredentialRegistry.Path.Entity,
            primaryCredential: p.corporateCid,
            screeningCredential: p.corporateCid, // the screening rides inside (ADR 0033)
            walletCredential: p.walletCid,
            authorityCredential: p.officerCid, // the officer who presented (ADR 0049)
            primarySchema: p.corporateSchema,
            screeningSchema: p.corporateSchema,
            checks: p.checks,
            jurisdiction: p.jurisdiction,
            investorClass: p.investorClass,
            screenedAt: p.issuedAt, // screened at issuance
            credentialExpiry: p.expiresAt,
            evidence: p.evidence
        });

        IIdentityRegistryWriter r = IIdentityRegistryWriter(vm.parseJsonAddress(j, ".instruments.registry"));
        uint32 flags = r.HOLD() | r.RECEIVE() | r.TRANSFER() | r.SANCTIONS_CLEAR();
        if (p.investorClass == 1 || p.investorClass == 2) flags |= r.PROFESSIONAL();
        if (p.contractWallet) flags |= r.CONTRACT_ACCOUNT();
        uint40 cap = uint40(block.timestamp) + REGISTRY_VALIDITY;
        uint40 registryExpiry = p.expiresAt < cap ? p.expiresAt : cap;

        vm.startBroadcast(vm.envUint("ACCESS_ISSUER_PK"));
        uint40 poolExpiry = gate.grant(a);
        r.grant(p.wallet, flags, _numeric(p.jurisdiction), registryExpiry, p.corporateCid, p.evidence);
        vm.stopBroadcast();

        console2.log("admitted       :", p.wallet);
        console2.log("pool grant to  :", poolExpiry);
        console2.log("registry grant :", registryExpiry);
    }

    function _read(string memory f, PoolCredentialRegistry gate) internal view returns (Presentation memory p) {
        require(_eq(vm.parseJsonString(f, ".verdict"), "GRANT"), "the verifier did not grant");
        require(_eq(vm.parseJsonString(f, ".issuerDid"), gate.issuerDid()), "not the pool's configured issuer");
        // The chain of trust: wallet, officer, corporation, corporate identity (ADRs 0046, 0050).
        require(
            _eq(vm.parseJsonString(f, ".walletControl.holderDid"), vm.parseJsonString(f, ".officer.holderDid")),
            "the wallet is bound to someone other than the presenting officer"
        );
        require(
            _eq(vm.parseJsonString(f, ".officer.corporationDid"), vm.parseJsonString(f, ".corporateIdentity.holderDid")),
            "the officer acts for another corporation"
        );

        string memory chain = vm.parseJsonString(f, ".walletControl.chain");
        string memory addressType = vm.parseJsonString(f, ".walletControl.addressType");
        p.contractWallet = _eq(addressType, "smart_contract");
        require(p.contractWallet || _eq(addressType, "eoa"), "unknown wallet type");
        require(_startsWith(chain, "eip155:"), "not an EVM chain");
        // An ordinary wallet's control holds on every EVM chain; a contract wallet's only on the
        // chain its signature was checked on (ADR 0042).
        if (p.contractWallet) {
            require(_eq(chain, string.concat("eip155:", vm.toString(block.chainid))), "contract wallet attested on another chain");
        }

        p.wallet = vm.parseJsonAddress(f, ".walletControl.walletAddress");
        p.walletCid = vm.parseJsonBytes32(f, ".walletControl.cid");
        p.officerCid = vm.parseJsonBytes32(f, ".officer.cid");
        p.corporateCid = vm.parseJsonBytes32(f, ".corporateIdentity.cid");
        p.corporateSchema = keccak256(bytes(vm.parseJsonString(f, ".corporateIdentity.schemaUri")));
        p.evidence = vm.parseJsonBytes32(f, ".verificationRecordSha256");
        p.jurisdiction = bytes2(bytes(vm.parseJsonString(f, ".corporateIdentity.jurisdiction")));
        // Institutional by policy when the credential carries no class (ADR 0053).
        p.investorClass = vm.keyExistsJson(f, ".corporateIdentity.investorClass")
            ? _class(vm.parseJsonString(f, ".corporateIdentity.investorClass"))
            : 2;
        p.issuedAt = uint40(vm.parseJsonUint(f, ".corporateIdentity.issuedAt"));
        // A grant rests on every credential presented, so it ends with the first to expire; the
        // officer credential's validity is the bank's refresh period (ADR 0052).
        p.expiresAt = uint40(vm.parseJsonUint(f, ".corporateIdentity.expiresAt"));
        uint40 officerExpiry = uint40(vm.parseJsonUint(f, ".officer.expiresAt"));
        uint40 walletExpiry = uint40(vm.parseJsonUint(f, ".walletControl.expiresAt"));
        if (officerExpiry < p.expiresAt) p.expiresAt = officerExpiry;
        if (walletExpiry < p.expiresAt) p.expiresAt = walletExpiry;

        // The checks the Access Issuer reports, each read from the presentation, never assumed.
        p.checks = 1; // wallet control: verified by the verifier and bound to the holder above
        if (vm.parseJsonBool(f, ".corporateIdentity.notExpired")) p.checks |= 2;
        if (_eq(vm.parseJsonString(f, ".corporateIdentity.status"), "active")) p.checks |= 4;
        if (vm.parseJsonBool(f, ".corporateIdentity.sanctionsClean")) p.checks |= 16;
    }

    /// The screening schema's investor classes, in its order (ADR 0033).
    function _class(string memory c) internal pure returns (uint8) {
        if (_eq(c, "sophisticated")) return 0;
        if (_eq(c, "professional")) return 1;
        if (_eq(c, "institutional")) return 2;
        if (_eq(c, "retail")) return 3;
        revert("unknown investor class");
    }

    /// ISO 3166-1 numeric, as the Identity Registry records jurisdiction, for the pool's allowlist.
    function _numeric(bytes2 a) internal pure returns (uint16) {
        bytes2[32] memory alpha = [
            bytes2("AT"), "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV",
            "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH", "GB"
        ];
        uint16[32] memory numeric = [
            uint16(40), 56, 100, 191, 196, 203, 208, 233, 246, 250, 276, 300, 348, 372, 380, 428,
            440, 442, 470, 528, 616, 620, 642, 703, 705, 724, 752, 352, 438, 578, 756, 826
        ];
        for (uint256 k = 0; k < alpha.length; ++k) {
            if (alpha[k] == a) return numeric[k];
        }
        revert("jurisdiction outside the pool's allowlist");
    }

    function _eq(string memory x, string memory y) internal pure returns (bool) {
        return keccak256(bytes(x)) == keccak256(bytes(y));
    }

    function _startsWith(string memory s, string memory prefix) internal pure returns (bool) {
        bytes memory b = bytes(s);
        bytes memory q = bytes(prefix);
        if (b.length < q.length) return false;
        for (uint256 k = 0; k < q.length; ++k) {
            if (b[k] != q[k]) return false;
        }
        return true;
    }
}
