// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {IPermissionsAdapter} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IPermissionsAdapter.sol";
import {IPermissionsAdapterFactory} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IPermissionsAdapterFactory.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

/**
 * Verifies and enables the adapter, opens the pool and has investor A seed it.
 *
 * The opening price is 100 cash per unit of the asset. The pool quotes currency1 per
 * currency0 in base units, and the two currencies are ordered by address, so the price is
 * derived from whichever order the deployment produced and from both tokens' decimals. A
 * constant computed for one order opens the pool at an inverted price whenever the addresses
 * sort the other way.
 */
contract ActivateVenue is Script {
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint256 constant CASH_PER_ASSET = 100;

    /// @dev Liquidity is concentrated within 6000 ticks either side (about 1.8x), so swaps of
    ///      the sizes the tests use show modest slippage.
    int24 constant RANGE_TICKS = 6000;

    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        uint256 seederPk = vm.envUint("INVESTOR_A_PK");
        address seeder = vm.addr(seederPk);

        string memory j = vm.readFile("ops/addresses.json");
        address asset = vm.parseJsonAddress(j, ".assets.venueAsset.address");
        address cash = vm.parseJsonAddress(j, ".assets.cash.address");
        address adapter = vm.parseJsonAddress(j, ".venue.permissionsAdapter");
        address factory = vm.parseJsonAddress(j, ".venue.adapterFactory");
        address hook = vm.parseJsonAddress(j, ".venue.hook");
        address router = vm.parseJsonAddress(j, ".venue.router");
        address posm = vm.parseJsonAddress(j, ".venue.positionManager");
        address permit2 = vm.parseJsonAddress(j, ".venue.permit2");
        address poolManager = vm.parseJsonAddress(j, ".venue.poolManager");

        // ---------------- Issuer: verify and enable the adapter ---------------- //
        vm.startBroadcast(issuerPk);

        IPermissionsAdapterFactory(factory).verifyPermissionsAdapter(adapter);

        IPermissionsAdapter pa = IPermissionsAdapter(adapter);
        pa.updateAllowedWrapper(router, true);
        pa.updateAllowedWrapper(posm, true);
        pa.updateAllowedHook(IHooks(hook), true);
        pa.updateSwappingEnabled(true);

        // ---------------- open the pool ---------------- //
        bool adapterIsCurrency0 = adapter < cash;
        (Currency c0, Currency c1) = adapterIsCurrency0
            ? (Currency.wrap(adapter), Currency.wrap(cash))
            : (Currency.wrap(cash), Currency.wrap(adapter));

        PoolKey memory key =
            PoolKey({currency0: c0, currency1: c1, fee: FEE, tickSpacing: TICK_SPACING, hooks: IHooks(hook)});

        uint160 sqrtPriceX96 = _openingPrice(
            adapterIsCurrency0,
            vm.parseJsonUint(j, ".assets.venueAsset.decimals"),
            vm.parseJsonUint(j, ".assets.cash.decimals")
        );
        IPoolManager(poolManager).initialize(key, sqrtPriceX96);
        vm.stopBroadcast();

        console2.log("pool initialized. currency0:", Currency.unwrap(c0));
        console2.log("                  currency1:", Currency.unwrap(c1));

        // ---------------- investor A seeds liquidity ---------------- //
        int24 current = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        int24 lower = _align(current - RANGE_TICKS);
        int24 upper = _align(current + RANGE_TICKS);
        console2.log("current tick:", current);

        uint256 amountAsset = 100_000e18;
        uint256 amountCash = 10_000_000e6;
        (uint256 amount0Max, uint256 amount1Max) =
            adapterIsCurrency0 ? (amountAsset, amountCash) : (amountCash, amountAsset);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(lower),
            TickMath.getSqrtPriceAtTick(upper),
            amount0Max,
            amount1Max
        );
        console2.log("liquidity:", liquidity);

        // Every investor is approved in advance, so that a trade is one transaction. Investor D
        // is included deliberately: the refusal must come from the gate, not a missing approval.
        uint256[4] memory traderKeys = [
            seederPk,
            vm.envUint("INVESTOR_B_PK"),
            vm.envUint("INVESTOR_C_PK"),
            vm.envUint("INVESTOR_D_PK")
        ];
        for (uint256 i = 0; i < traderKeys.length; ++i) {
            vm.startBroadcast(traderKeys[i]);
            IERC20(asset).approve(permit2, type(uint256).max);
            IERC20(cash).approve(permit2, type(uint256).max);
            IAllowanceTransfer(permit2).approve(asset, posm, type(uint160).max, type(uint48).max);
            IAllowanceTransfer(permit2).approve(cash, posm, type(uint160).max, type(uint48).max);
            IAllowanceTransfer(permit2).approve(asset, router, type(uint160).max, type(uint48).max);
            IAllowanceTransfer(permit2).approve(cash, router, type(uint160).max, type(uint48).max);
            vm.stopBroadcast();
        }

        vm.startBroadcast(seederPk);
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, liquidity, amount0Max, amount1Max, seeder, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);

        IPositionManager(posm).modifyLiquidities(abi.encode(actions, params), block.timestamp + 3600);
        vm.stopBroadcast();

        console2.log("liquidity minted to investor A");

        string memory obj = "pool";
        vm.serializeAddress(obj, "currency0", Currency.unwrap(c0));
        vm.serializeAddress(obj, "currency1", Currency.unwrap(c1));
        vm.serializeUint(obj, "fee", FEE);
        vm.serializeInt(obj, "tickSpacing", TICK_SPACING);
        vm.serializeInt(obj, "tickLower", lower);
        vm.serializeInt(obj, "tickUpper", upper);
        vm.serializeUint(obj, "sqrtPriceX96", sqrtPriceX96);
        string memory out = vm.serializeAddress(obj, "hook", hook);
        vm.writeJson(out, "ops/addresses.json", ".pool");
    }

    /**
     * @dev sqrt(currency1 base units per currency0 base unit) in Q64.96. The adapter carries
     *      the asset's decimals. With cash per asset P, the ratio is P * 10^cashDecimals /
     *      10^assetDecimals when the asset is currency0, and its reciprocal otherwise.
     */
    function _openingPrice(bool assetIsCurrency0, uint256 assetDecimals, uint256 cashDecimals)
        internal
        pure
        returns (uint160)
    {
        uint256 cashUnits = CASH_PER_ASSET * 10 ** cashDecimals;
        uint256 assetUnits = 10 ** assetDecimals;
        (uint256 num, uint256 den) = assetIsCurrency0 ? (cashUnits, assetUnits) : (assetUnits, cashUnits);
        return uint160(Math.sqrt(Math.mulDiv(num, 1 << 192, den)));
    }

    function _align(int24 tick) private pure returns (int24) {
        return (tick / TICK_SPACING) * TICK_SPACING;
    }
}
