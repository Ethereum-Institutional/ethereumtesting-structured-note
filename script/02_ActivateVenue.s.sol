// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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

import {ERC3643AllowlistChecker} from "../contracts/ERC3643AllowlistChecker.sol";
import {DemoUSDC} from "../contracts/DemoUSDC.sol";

/**
 * Activates the venue once the issuer has allow-listed the adapter, then opens the pool.
 *
 * Price: 1 APMMF = 100 USDC. Because the asset carries 18 decimals and the stablecoin 6,
 * the raw token1/token0 ratio is 1e-10, so sqrtPriceX96 = 1e-5 * 2**96.
 */
contract ActivateVenue is Script {
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint160 constant SQRT_PRICE_100_USDC = 792281625142643375935439;

    /// @dev Liquidity is concentrated ±6000 ticks (~±1.8x) so demo swaps show modest slippage.
    int24 constant RANGE_TICKS = 6000;

    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        uint256 alicePk = vm.envUint("ALICE_PK");
        address issuer = vm.addr(issuerPk);
        address alice = vm.addr(alicePk);

        string memory j = vm.readFile("ops/addresses.json");
        address trexToken = vm.parseJsonAddress(j, ".trex.token");
        address adapter = vm.parseJsonAddress(j, ".venue.permissionsAdapter");
        address factory = vm.parseJsonAddress(j, ".venue.adapterFactory");
        address hook = vm.parseJsonAddress(j, ".venue.hook");
        address router = vm.parseJsonAddress(j, ".venue.router");
        address posm = vm.parseJsonAddress(j, ".venue.positionManager");
        address usdc = vm.parseJsonAddress(j, ".venue.usdc");
        address permit2 = vm.parseJsonAddress(j, ".venue.permit2");
        address poolManager = vm.parseJsonAddress(j, ".venue.poolManager");

        // ---------------- issuer: activate the adapter ---------------- //
        vm.startBroadcast(issuerPk);

        IPermissionsAdapterFactory(factory).verifyPermissionsAdapter(adapter);

        IPermissionsAdapter pa = IPermissionsAdapter(adapter);
        pa.updateAllowedWrapper(router, true);
        pa.updateAllowedWrapper(posm, true);
        pa.updateAllowedHook(IHooks(hook), true);
        pa.updateSwappingEnabled(true);

        // Settlement liquidity for the demo participants.
        DemoUSDC(usdc).mint(alice, 40_000_000e6);
        DemoUSDC(usdc).mint(vm.addr(vm.envUint("BOB_PK")), 500_000e6);
        DemoUSDC(usdc).mint(vm.addr(vm.envUint("CAROL_PK")), 500_000e6);
        DemoUSDC(usdc).mint(vm.addr(vm.envUint("DAVE_PK")), 500_000e6);

        // ---------------- open the pool ---------------- //
        (Currency c0, Currency c1) = adapter < usdc
            ? (Currency.wrap(adapter), Currency.wrap(usdc))
            : (Currency.wrap(usdc), Currency.wrap(adapter));

        PoolKey memory key =
            PoolKey({currency0: c0, currency1: c1, fee: FEE, tickSpacing: TICK_SPACING, hooks: IHooks(hook)});

        IPoolManager(poolManager).initialize(key, SQRT_PRICE_100_USDC);
        vm.stopBroadcast();

        console2.log("pool initialized. currency0:", Currency.unwrap(c0));
        console2.log("                  currency1:", Currency.unwrap(c1));

        // ---------------- Alice seeds liquidity ---------------- //
        int24 current = TickMath.getTickAtSqrtPrice(SQRT_PRICE_100_USDC);
        int24 lower = _align(current - RANGE_TICKS);
        int24 upper = _align(current + RANGE_TICKS);
        console2.log("current tick:", current);

        uint256 amountAsset = 100_000e18; // APMMF
        uint256 amountCash = 10_000_000e6; // USDC at 100/unit
        (uint256 amount0Max, uint256 amount1Max) =
            adapter < usdc ? (amountAsset, amountCash) : (amountCash, amountAsset);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            SQRT_PRICE_100_USDC,
            TickMath.getSqrtPriceAtTick(lower),
            TickMath.getSqrtPriceAtTick(upper),
            amount0Max,
            amount1Max
        );
        console2.log("liquidity:", liquidity);

        // Pre-approve every demo participant so the dashboard can trade in a single
        // transaction rather than three. Dave is included deliberately: his swap must fail
        // on the compliance gate, not on a missing approval.
        uint256[4] memory traderKeys = [alicePk, vm.envUint("BOB_PK"), vm.envUint("CAROL_PK"), vm.envUint("DAVE_PK")];
        for (uint256 i = 0; i < traderKeys.length; ++i) {
            vm.startBroadcast(traderKeys[i]);
            IERC20(trexToken).approve(permit2, type(uint256).max);
            IERC20(usdc).approve(permit2, type(uint256).max);
            IAllowanceTransfer(permit2).approve(trexToken, posm, type(uint160).max, type(uint48).max);
            IAllowanceTransfer(permit2).approve(usdc, posm, type(uint160).max, type(uint48).max);
            IAllowanceTransfer(permit2).approve(trexToken, router, type(uint160).max, type(uint48).max);
            IAllowanceTransfer(permit2).approve(usdc, router, type(uint160).max, type(uint48).max);
            vm.stopBroadcast();
        }

        vm.startBroadcast(alicePk);
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, liquidity, amount0Max, amount1Max, alice, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);

        IPositionManager(posm).modifyLiquidities(abi.encode(actions, params), block.timestamp + 3600);
        vm.stopBroadcast();

        console2.log("liquidity minted to Alice");

        string memory obj = "pool";
        vm.serializeAddress(obj, "currency0", Currency.unwrap(c0));
        vm.serializeAddress(obj, "currency1", Currency.unwrap(c1));
        vm.serializeUint(obj, "fee", FEE);
        vm.serializeInt(obj, "tickSpacing", TICK_SPACING);
        vm.serializeInt(obj, "tickLower", lower);
        vm.serializeInt(obj, "tickUpper", upper);
        vm.serializeUint(obj, "sqrtPriceX96", SQRT_PRICE_100_USDC);
        string memory out = vm.serializeAddress(obj, "hook", hook);
        vm.writeJson(out, "ops/addresses.json", ".pool");
    }

    function _align(int24 tick) private pure returns (int24) {
        int24 aligned = (tick / TICK_SPACING) * TICK_SPACING;
        return aligned;
    }
}
