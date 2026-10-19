// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";

interface ISafe {
    function nonce() external view returns (uint256);
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) external view returns (bytes32);
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes calldata signatures
    ) external payable returns (bool);
}

/**
 * Acts through a multi-signature wallet from a script: the wallet's signers sign the
 * transaction, in ascending order of their addresses as the wallet requires, and whoever is
 * broadcasting submits it. Used where the Issuer's wallet issues notes.
 */
library WalletExec {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function exec(address wallet, address to, bytes memory data, uint256[] memory signerKeys) internal {
        ISafe safe = ISafe(wallet);
        bytes32 hash = safe.getTransactionHash(to, 0, data, 0, 0, 0, 0, address(0), address(0), safe.nonce());
        _sortByAddress(signerKeys);
        bytes memory signatures;
        for (uint256 k = 0; k < signerKeys.length; ++k) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKeys[k], hash);
            signatures = abi.encodePacked(signatures, r, s, v);
        }
        require(
            safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures),
            "the wallet's transaction failed"
        );
    }

    function _sortByAddress(uint256[] memory keys) private pure {
        for (uint256 i = 1; i < keys.length; ++i) {
            uint256 key = keys[i];
            address a = vm.addr(key);
            uint256 j = i;
            while (j > 0 && vm.addr(keys[j - 1]) > a) {
                keys[j] = keys[j - 1];
                --j;
            }
            keys[j] = key;
        }
    }
}
