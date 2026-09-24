// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;

/**
 * @title IDepositGateway
 * @notice What a deposit service must expose for its deposits to settle on a public network.
 *
 * A tokenized deposit is a liability of the institution holding it. It comes into existence on
 * credit to an account and ceases to exist on debit, and nothing else creates or destroys it.
 * The gateway is the only party that can do either, and every call carries the reference of the
 * booking in the institution's own ledger, so each on-chain movement reconciles to one entry.
 *
 * Neither call can reach an account that the deposit's gate refuses: a credit to an account that
 * cannot receive reverts in the token. A debit takes from the account's own balance and never
 * from its frozen part unless the frozen part is released first.
 */
interface IDepositGateway {
    /// @notice Emitted once per credit, with the ledger booking it reflects.
    event Credited(address indexed account, uint256 amount, bytes32 indexed bookingRef);
    /// @notice Emitted once per debit, with the ledger booking it reflects.
    event Debited(address indexed account, uint256 amount, bytes32 indexed bookingRef);

    error ReferenceUsed(bytes32 bookingRef);
    error ZeroReference();

    /// @notice Creates deposit on credit to `account`. A reference can be used once.
    function credit(address account, uint256 amount, bytes32 bookingRef) external;

    /// @notice Extinguishes deposit on debit from `account`. A reference can be used once.
    function debit(address account, uint256 amount, bytes32 bookingRef) external;

    /// @notice Whether a ledger reference has already been booked.
    function booked(bytes32 bookingRef) external view returns (bool);
}
