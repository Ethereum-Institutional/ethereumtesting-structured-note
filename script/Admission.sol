// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolCredentialRegistry} from "../contracts/PoolCredentialRegistry.sol";

/**
 * The attestation the Access Issuer writes once a presentation has been verified off-chain.
 * Used by the deploy scripts, standing in for that verification: every check passed, screened a
 * day before, the credential valid for a year. The identifiers are references derived from
 * `ref`, not credentials.
 */
library Admission {
    uint32 internal constant ENTITY_CHECKS = 1 | 2 | 4; // wallet control, not expired, entity active
    uint32 internal constant PERSON_CHECKS = 1 | 2 | 8 | 16 | 32; // + over 18, sanctions clean, not PEP

    function attest(
        address account,
        bool isEntity,
        bytes32 primarySchema,
        bytes32 screeningSchema,
        bytes2 jurisdiction,
        uint8 investorClass,
        string memory ref
    ) internal view returns (PoolCredentialRegistry.Attestation memory) {
        return PoolCredentialRegistry.Attestation({
            account: account,
            path: isEntity ? PoolCredentialRegistry.Path.Entity : PoolCredentialRegistry.Path.Person,
            primaryCredential: keccak256(abi.encodePacked(ref, "/primary")),
            screeningCredential: keccak256(abi.encodePacked(ref, "/screening")),
            primarySchema: primarySchema,
            screeningSchema: screeningSchema,
            checks: isEntity ? ENTITY_CHECKS : PERSON_CHECKS,
            jurisdiction: jurisdiction,
            investorClass: investorClass,
            screenedAt: uint40(block.timestamp - 1 days),
            credentialExpiry: uint40(block.timestamp + 365 days),
            evidence: keccak256(abi.encodePacked(ref, "/evidence"))
        });
    }
}
