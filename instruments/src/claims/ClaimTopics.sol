// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;

/**
 * The claim topics of the deployment (ADR 0088). A client has one ONCHAINID identity, and each
 * institution vouches on it for what it is responsible for: one identity, claims by role.
 */
library ClaimTopics {
    /// @notice The bank has onboarded the client and holds its deposit account: it may hold the
    ///         tokenized deposit. Issued by the bank's claim issuer.
    uint256 internal constant DEPOSIT_ELIGIBLE = uint256(keccak256("claim.deposit-eligible"));

    /// @notice An onboarding agent has verified the client for the note: eligible under the
    ///         note's selling restrictions (Regulation S) and sanctions-screened. Issued by an
    ///         onboarding agent's claim issuer: a dealer, distributor, custodian or CSD.
    uint256 internal constant NOTE_ELIGIBLE = uint256(keccak256("claim.note-eligible"));

    /// @notice On the note's own identity: the hash and location of its term sheet, self-attested
    ///         by the note's owner at issuance.
    uint256 internal constant TERM_SHEET = uint256(keccak256("claim.term-sheet"));
}
