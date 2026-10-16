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

    /// @notice The bank admits its client to the conversion pool: a professional or institutional
    ///         investor, screened, that may convert between the payment token and the deposit.
    ///         Issued by the bank's claim issuer, and read by the pool's gate through the pool's
    ///         own identity registry (ADR 0090).
    uint256 internal constant POOL_ACCESS = uint256(keccak256("claim.pool-access"));

    /// @notice On the note's own identity: the hash and location of its term sheet, self-attested
    ///         by the note's owner at issuance.
    uint256 internal constant TERM_SHEET = uint256(keccak256("claim.term-sheet"));

    /// @notice A note's identity within the programme, stated by the note's owner on its own
    ///         identity: its series number and its ISIN, where one is given (ADR 0115).
    uint256 internal constant SERIES = uint256(keccak256("claim.series"));
}
