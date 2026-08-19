// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title CustodyAccount
 * @notice A segregated client account operated by a custodian.
 *
 * Each client of the custodian gets one of these. The account is the on-chain holder of
 * record: it carries its own ONCHAINID, its own KYC claim, and its own entry in the
 * issuer's identity registry, so the issuer can freeze, force-transfer or report on a
 * single client without touching any other. Client assets are never commingled.
 *
 * The custodian holds the keys and signs; the client never does. That split is the point --
 * on-chain segregation with custodial control, which is what a regulated custodian needs
 * and what an omnibus wallet cannot give you.
 *
 * ERC-1271 lets the account itself be a signature counterparty (e.g. Permit2), validating
 * against the custodian's key.
 *
 * NOTE: The production shape of this is an ERC-4337 account with ERC-7821 batched
 * execution -- exactly what OpenZeppelin's Contracts MCP generates for `solidity-account`.
 * That output requires OpenZeppelin ^5.7.0 and pragma ^0.8.27, while Uniswap's
 * `PermissionsAdapter` pins `solidity 0.8.26` exactly, so the two cannot share a
 * compilation unit today. This contract deliberately mirrors that design on the primitives
 * available here; swapping in the 4337 account is a drop-in once the pragmas align.
 */
contract CustodyAccount is IERC1271 {
    using Address for address;

    /// @notice The custodian operator authorised to act for this client. Should be a multisig.
    address public immutable CUSTODIAN;

    /// @notice Opaque client reference for reconciliation against the custodian's books.
    string public clientRef;

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    event Executed(address indexed target, uint256 value, bytes data);

    error NotCustodian(address caller);
    error EmptyBatch();

    constructor(address custodian, string memory clientRef_) {
        CUSTODIAN = custodian;
        clientRef = clientRef_;
    }

    modifier onlyCustodian() {
        if (msg.sender != CUSTODIAN) revert NotCustodian(msg.sender);
        _;
    }

    /**
     * @notice Executes a batch of calls as this client account.
     * @dev Batched so a trade and its approvals settle atomically. Every call is attributed
     *      on-chain to this client, which is what makes the custodian's actions auditable
     *      per client rather than in aggregate.
     */
    function execute(Call[] calldata calls) external onlyCustodian returns (bytes[] memory results) {
        if (calls.length == 0) revert EmptyBatch();
        results = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; ++i) {
            results[i] = calls[i].target.functionCallWithValue(calls[i].data, calls[i].value);
            emit Executed(calls[i].target, calls[i].value, calls[i].data);
        }
    }

    /// @notice Convenience single-call form.
    function executeOne(address target, uint256 value, bytes calldata data)
        external
        onlyCustodian
        returns (bytes memory)
    {
        bytes memory result = target.functionCallWithValue(data, value);
        emit Executed(target, value, data);
        return result;
    }

    /// @inheritdoc IERC1271
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == CUSTODIAN) {
            return IERC1271.isValidSignature.selector;
        }
        // Also accept an EIP-191 personal-signed digest, which some clients produce.
        (address recovered2, ECDSA.RecoverError err2,) =
            ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(hash), signature);
        if (err2 == ECDSA.RecoverError.NoError && recovered2 == CUSTODIAN) {
            return IERC1271.isValidSignature.selector;
        }
        return 0xffffffff;
    }

    receive() external payable {}
}
