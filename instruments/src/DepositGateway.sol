// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IDepositGateway} from "./interfaces/IDepositGateway.sol";

interface IMintBurn {
    function mint(address account, uint256 value) external;
    function burn(address account, uint256 value) external;
}

/**
 * @title DepositGateway
 * @notice Stands in for a deposit service. The sole holder of mint and burn on the tokenized
 *         deposit; operated by the Deposit Agent.
 *
 * References are single-use, so a booking replayed by mistake cannot credit twice.
 */
contract DepositGateway is IDepositGateway, AccessControl {
    bytes32 public constant DEPOSIT_AGENT_ROLE = keccak256("DEPOSIT_AGENT_ROLE");

    IMintBurn public immutable DEPOSIT;

    mapping(bytes32 bookingRef => bool) public booked;

    constructor(IMintBurn deposit, address admin, address depositAgent) {
        DEPOSIT = deposit;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DEPOSIT_AGENT_ROLE, depositAgent);
    }

    /// @inheritdoc IDepositGateway
    function credit(address account, uint256 amount, bytes32 bookingRef) external onlyRole(DEPOSIT_AGENT_ROLE) {
        _book(bookingRef);
        DEPOSIT.mint(account, amount);
        emit Credited(account, amount, bookingRef);
    }

    /// @inheritdoc IDepositGateway
    function debit(address account, uint256 amount, bytes32 bookingRef) external onlyRole(DEPOSIT_AGENT_ROLE) {
        _book(bookingRef);
        DEPOSIT.burn(account, amount);
        emit Debited(account, amount, bookingRef);
    }

    function _book(bytes32 bookingRef) private {
        if (bookingRef == bytes32(0)) revert ZeroReference();
        if (booked[bookingRef]) revert ReferenceUsed(bookingRef);
        booked[bookingRef] = true;
    }
}
