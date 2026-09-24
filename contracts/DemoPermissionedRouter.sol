// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {PermissionedV4Router} from "@uniswap/v4-periphery/src/hooks/permissionedPools/PermissionedV4Router.sol";
import {ReentrancyLock} from "@uniswap/v4-periphery/src/base/ReentrancyLock.sol";
import {IPermissionsAdapter} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IPermissionsAdapter.sol";
import {IPermissionsAdapterFactory} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IPermissionsAdapterFactory.sol";

/**
 * @title DemoPermissionedRouter
 * @notice Minimal concrete swap router for permissioned pools.
 *
 * `PermissionedV4Router` is abstract. In production the concrete implementation is the
 * AMM's universal router (v2.2.0 or later). This is a deliberately small stand-in that
 * implements only what a permissioned swap needs, so the venue does not depend on a
 * universal router deployment.
 *
 * The important part is `_payPermissionedFromPayer`: the payer's real permissioned tokens
 * move into the permissions adapter, and the adapter then mints the matching virtual
 * amount straight to the PoolManager. The restricted asset never sits in the PoolManager,
 * which is what keeps the pool compatible with a token that enforces transfer rules.
 *
 * `msgSender()` returns the reentrancy locker, the original EOA, which is the address the
 * hook checks against the asset's eligibility.
 */
contract DemoPermissionedRouter is PermissionedV4Router, ReentrancyLock {
    IAllowanceTransfer public immutable PERMIT2;

    error TransactionDeadlinePassed();

    constructor(IPoolManager poolManager_, IAllowanceTransfer permit2_, IPermissionsAdapterFactory factory_)
        PermissionedV4Router(poolManager_, factory_)
    {
        PERMIT2 = permit2_;
    }

    receive() external payable {
        require(msg.sender == address(poolManager), "unexpected ETH");
    }

    /**
     * @notice Executes an encoded v4 action plan (`abi.encode(actions, params)`).
     * @dev Reverts if the pool's hook is not allow-listed by the adapter's owner --
     *      enforced by `PermissionedV4Router._validatePoolKey`.
     */
    function execute(bytes calldata unlockData, uint256 deadline) external payable isNotLocked {
        if (block.timestamp > deadline) revert TransactionDeadlinePassed();
        _executeActions(unlockData);
    }

    /// @dev The account the hook evaluates: the original EOA, not this router.
    function msgSender() public view override returns (address) {
        return _getLocker();
    }

    /// @dev Unrestricted leg (e.g. the stablecoin): pay the PoolManager directly.
    function _payStandard(Currency currency, address payer, uint256 amount) internal override {
        if (payer == address(this)) {
            currency.transfer(address(poolManager), amount);
        } else {
            PERMIT2.transferFrom(payer, address(poolManager), uint160(amount), Currency.unwrap(currency));
        }
    }

    /// @dev Permissioned leg: real tokens into the adapter, virtual tokens minted to the PoolManager.
    function _payPermissionedFromPayer(
        address payer,
        IPermissionsAdapter permissionsAdapter,
        address permissionedToken,
        uint256 amount
    ) internal override {
        PERMIT2.transferFrom(payer, address(permissionsAdapter), uint160(amount), permissionedToken);
        permissionsAdapter.wrapToPoolManager(amount);
    }
}
