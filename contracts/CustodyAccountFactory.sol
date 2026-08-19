// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CustodyAccount} from "./CustodyAccount.sol";

/**
 * @title CustodyAccountFactory
 * @notice Deploys segregated client accounts for one custodian at deterministic addresses.
 *
 * Deterministic addresses matter operationally: the custodian can hand the issuer a client's
 * account address for KYC onboarding *before* the account is deployed, so identity
 * registration and account creation do not have to be serialised.
 */
contract CustodyAccountFactory {
    address public immutable CUSTODIAN;

    address[] private _accounts;
    mapping(bytes32 clientRefHash => address account) public accountOf;

    event CustodyAccountCreated(address indexed account, string clientRef);

    error NotCustodian(address caller);
    error AlreadyExists(string clientRef);

    constructor(address custodian) {
        CUSTODIAN = custodian;
    }

    function createAccount(string calldata clientRef) external returns (address account) {
        if (msg.sender != CUSTODIAN) revert NotCustodian(msg.sender);
        bytes32 refHash = keccak256(bytes(clientRef));
        if (accountOf[refHash] != address(0)) revert AlreadyExists(clientRef);

        account = address(new CustodyAccount{salt: refHash}(CUSTODIAN, clientRef));
        accountOf[refHash] = account;
        _accounts.push(account);
        emit CustodyAccountCreated(account, clientRef);
    }

    /// @notice Predicts a client account address before deployment, for pre-registration.
    function predictAddress(string calldata clientRef) external view returns (address) {
        bytes32 refHash = keccak256(bytes(clientRef));
        bytes memory creation =
            abi.encodePacked(type(CustodyAccount).creationCode, abi.encode(CUSTODIAN, clientRef));
        return address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), address(this), refHash, keccak256(creation)))
                )
            )
        );
    }

    function accounts() external view returns (address[] memory) {
        return _accounts;
    }

    function accountCount() external view returns (uint256) {
        return _accounts.length;
    }
}
