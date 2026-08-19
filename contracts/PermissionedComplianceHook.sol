// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Hooks, IHooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

import {BaseHook} from "uniswap-hooks/src/base/BaseHook.sol";

import {IMsgSender} from "@uniswap/v4-periphery/src/interfaces/IMsgSender.sol";
import {IPermissionsAdapter} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IPermissionsAdapter.sol";
import {IPermissionsAdapterFactory} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IPermissionsAdapterFactory.sol";
import {PermissionFlags, PermissionFlag} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";

/**
 * @title PermissionedComplianceHook
 * @notice Uniswap v4 hook that gates every swap and liquidity addition on an
 *         issuer-controlled allowlist, built on the OpenZeppelin Uniswap Hooks library.
 *
 * v4-periphery ships the `PermissionsAdapter`, router and position manager for
 * permissioned pools, but deliberately leaves the hook itself to the integrator --
 * the only production hook in the repo is a test mock. This is that hook, written
 * against OpenZeppelin's `BaseHook`.
 *
 * Enforcement points:
 *   - `beforeInitialize`     -- at least one side must be a *verified* permissions adapter,
 *                              so a permissioned asset can never be paired into an ungated pool.
 *   - `beforeSwap`           -- both sides checked for `SWAP_ALLOWED`; swapping must be enabled.
 *   - `beforeAddLiquidity`   -- both sides checked for `LIQUIDITY_ALLOWED`.
 *   - `afterSwap`            -- emits a settled-trade record for custody/surveillance feeds.
 *
 * The account under test is the *original* caller, recovered via `IMsgSender.msgSender()`,
 * not the router -- so routing through periphery cannot launder an unapproved wallet. The
 * router itself must also be an approved wrapper on the adapter, which closes multi-hop
 * routes into the asset.
 */
contract PermissionedComplianceHook is BaseHook {
    using StateLibrary for IPoolManager;

    /// @notice The factory that records which adapters are verified against which tokens.
    IPermissionsAdapterFactory public immutable PERMISSIONS_ADAPTER_FACTORY;

    /// @notice Emitted after a compliant swap settles. Mirrors the pool state post-trade.
    event PermissionedSwap(
        PoolId indexed id,
        address indexed account,
        address indexed router,
        int128 amount0,
        int128 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick,
        uint24 fee
    );

    /// @notice Emitted when a permissioned pool is initialised through this hook.
    event PermissionedPoolInitialized(PoolId indexed id, address indexed currency0, address indexed currency1);

    /// @dev The original caller is not permitted for this action on this asset.
    error NotAllowlisted(address account, address adapter, PermissionFlag required);
    /// @dev The router used is not an approved wrapper on the adapter.
    error UnauthorizedRouter(address router, address adapter);
    /// @dev The issuer has switched swapping off for this asset.
    error SwappingDisabled(address adapter);
    /// @dev Neither side of the pool is a permissions adapter.
    error NoPermissionsAdapter();
    /// @dev A side is an adapter, but the factory has not verified it against its token.
    error UnverifiedPermissionsAdapter(address adapter);
    /// @dev The caller does not expose `msgSender()`, so the true account cannot be established.
    error OriginatorUnavailable(address sender);

    constructor(IPoolManager _poolManager, IPermissionsAdapterFactory _factory) BaseHook(_poolManager) {
        PERMISSIONS_ADAPTER_FACTORY = _factory;
    }

    /// @inheritdoc BaseHook
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // --------------------------------------------------------------------- //
    //                            Hook entry points                          //
    // --------------------------------------------------------------------- //

    function _beforeInitialize(address, PoolKey calldata key, uint160) internal override returns (bytes4) {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);

        bool is0Adapter = PERMISSIONS_ADAPTER_FACTORY.permissionsAdapterOf(currency0) != address(0);
        bool is1Adapter = PERMISSIONS_ADAPTER_FACTORY.permissionsAdapterOf(currency1) != address(0);
        if (!is0Adapter && !is1Adapter) revert NoPermissionsAdapter();

        if (is0Adapter && PERMISSIONS_ADAPTER_FACTORY.verifiedPermissionsAdapterOf(currency0) == address(0)) {
            revert UnverifiedPermissionsAdapter(currency0);
        }
        if (is1Adapter && PERMISSIONS_ADAPTER_FACTORY.verifiedPermissionsAdapterOf(currency1) == address(0)) {
            revert UnverifiedPermissionsAdapter(currency1);
        }

        emit PermissionedPoolInitialized(key.toId(), currency0, currency1);
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _enforce(sender, key, PermissionFlags.SWAP_ALLOWED, true);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _beforeAddLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        internal
        override
        returns (bytes4)
    {
        _enforce(sender, key, PermissionFlags.LIQUIDITY_ALLOWED, false);
        return IHooks.beforeAddLiquidity.selector;
    }

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId id = key.toId();
        (uint160 sqrtPriceX96, int24 tick,, uint24 fee) = poolManager.getSlot0(id);

        emit PermissionedSwap(
            id,
            _originator(sender),
            sender,
            delta.amount0(),
            delta.amount1(),
            sqrtPriceX96,
            poolManager.getLiquidity(id),
            tick,
            fee
        );
        return (IHooks.afterSwap.selector, 0);
    }

    // --------------------------------------------------------------------- //
    //                               Enforcement                             //
    // --------------------------------------------------------------------- //

    /**
     * @dev Checks both sides of the pool. Sides that are not permissions adapters are
     *      skipped, so a permissioned/vanilla pair only gates the permissioned leg.
     */
    function _enforce(address sender, PoolKey calldata key, PermissionFlag required, bool requireSwappingEnabled)
        private
        view
    {
        address account = _originator(sender);
        _enforceSide(Currency.unwrap(key.currency0), account, sender, required, requireSwappingEnabled);
        _enforceSide(Currency.unwrap(key.currency1), account, sender, required, requireSwappingEnabled);
    }

    function _enforceSide(
        address adapter,
        address account,
        address router,
        PermissionFlag required,
        bool requireSwappingEnabled
    ) private view {
        // Not a verified adapter => not a permissioned asset => nothing to enforce.
        if (PERMISSIONS_ADAPTER_FACTORY.verifiedPermissionsAdapterOf(adapter) == address(0)) return;

        IPermissionsAdapter permissionsAdapter = IPermissionsAdapter(adapter);

        if (requireSwappingEnabled && !permissionsAdapter.swappingEnabled()) {
            revert SwappingDisabled(adapter);
        }
        if (!permissionsAdapter.allowedWrappers(router)) {
            revert UnauthorizedRouter(router, adapter);
        }
        if (!permissionsAdapter.isAllowed(account, required)) {
            revert NotAllowlisted(account, adapter, required);
        }
    }

    /// @dev Recovers the true initiating wallet from the periphery contract that called in.
    function _originator(address sender) private view returns (address) {
        try IMsgSender(sender).msgSender() returns (address account) {
            return account;
        } catch {
            revert OriginatorUnavailable(sender);
        }
    }
}
