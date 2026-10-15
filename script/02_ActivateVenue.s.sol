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

import {Manifest} from "./Manifest.sol";
import {PoolAccess} from "./PoolAccess.sol";

interface IDepositGateway {
    function credit(address account, uint256 amount, bytes32 bookingRef) external;
}

/**
 * Verifies and enables the adapter, opens the pool at par, admits the cast to the pool, and has
 * the Deposit Agent provide the pool's liquidity (ADRs 0038, 0090).
 *
 * Admission is the bank's pool-access claim on each participant's ONCHAINID identity
 * (script/PoolAccess.sol), standing in for the verification that precedes it in operation. The
 * Deposit Agent, investor A and investor B are admitted. Investor C is onboarded to the deposit
 * but not admitted, so the pool refuses it while the deposit does not: the pool's own perimeter
 * (ADR 0031). Investor D is onboarded nowhere.
 *
 * The pool quotes currency1 per currency0 in base units, and the currencies are ordered by
 * address, so the opening price is derived from whichever order the deployment produced and
 * from both tokens' decimals.
 */
contract ActivateVenue is Script {
    uint24 constant FEE = 500; // 0.05%
    int24 constant TICK_SPACING = 10;
    /// @dev About 0.5% either side of par (ADR 0038).
    int24 constant RANGE_TICKS = 50;

    uint256 constant LOCAL_SEED_DEPOSIT = 1_000_000_00; // EUR 1,000,000.00
    uint256 constant NETWORK_SEED_DEPOSIT = 100_000_00; // EUR 100,000.00

    struct Ctx {
        address deposit;
        address paymentToken;
        address adapter;
        address hook;
        address router;
        address posm;
        address permit2;
        address gateway;
        uint256 depositDecimals;
        uint256 paymentDecimals;
    }

    function run() external {
        string memory j = Manifest.read();
        Ctx memory c = Ctx({
            deposit: vm.parseJsonAddress(j, ".assets.deposit.address"),
            paymentToken: vm.parseJsonAddress(j, ".assets.paymentToken.address"),
            adapter: vm.parseJsonAddress(j, ".venue.permissionsAdapter"),
            hook: vm.parseJsonAddress(j, ".venue.hook"),
            router: vm.parseJsonAddress(j, ".venue.router"),
            posm: vm.parseJsonAddress(j, ".venue.positionManager"),
            permit2: vm.parseJsonAddress(j, ".venue.permit2"),
            gateway: vm.parseJsonAddress(j, ".instruments.gateway"),
            depositDecimals: vm.parseJsonUint(j, ".assets.deposit.decimals"),
            paymentDecimals: vm.parseJsonUint(j, ".assets.paymentToken.decimals")
        });

        // ---------------- Issuer: verify and enable the adapter, open the pool ---------------- //
        vm.startBroadcast(vm.envUint("ISSUER_PK"));
        IPermissionsAdapterFactory(vm.parseJsonAddress(j, ".venue.adapterFactory")).verifyPermissionsAdapter(c.adapter);
        IPermissionsAdapter pa = IPermissionsAdapter(c.adapter);
        pa.updateAllowedWrapper(c.router, true);
        pa.updateAllowedWrapper(c.posm, true);
        pa.updateAllowedHook(IHooks(c.hook), true);
        pa.updateSwappingEnabled(true);

        PoolKey memory key = _key(c);
        bool adapterIsCurrency0 = Currency.unwrap(key.currency0) == c.adapter;
        uint160 sqrtPriceX96 = _parPrice(adapterIsCurrency0, c.depositDecimals, c.paymentDecimals);
        IPoolManager(vm.parseJsonAddress(j, ".venue.poolManager")).initialize(key, sqrtPriceX96);
        vm.stopBroadcast();
        console2.log("pool opened at par. currency0:", Currency.unwrap(key.currency0));

        // ---------------- the bank: admit the cast to the pool ---------------- //
        _admit(j);

        // ---------------- approvals, so that a trade is one transaction ---------------- //
        // Investor D is included for the payment token: its refusal must come from the gate.
        _approve(vm.envUint("INVESTOR_A_PK"), c, true);
        _approve(vm.envUint("INVESTOR_B_PK"), c, true);
        _approve(vm.envUint("INVESTOR_C_PK"), c, true);
        _approve(vm.envUint("INVESTOR_D_PK"), c, false);
        _approve(vm.envUint("DEPOSIT_AGENT_PK"), c, true);

        // ---------------- Deposit Agent: the pool's liquidity ---------------- //
        (int24 lower, int24 upper, uint128 liquidity) = _seed(c, key, sqrtPriceX96);
        _record(key, lower, upper, sqrtPriceX96, liquidity);
    }

    function _key(Ctx memory c) internal pure returns (PoolKey memory) {
        (Currency c0, Currency c1) = c.adapter < c.paymentToken
            ? (Currency.wrap(c.adapter), Currency.wrap(c.paymentToken))
            : (Currency.wrap(c.paymentToken), Currency.wrap(c.adapter));
        return PoolKey({currency0: c0, currency1: c1, fee: FEE, tickSpacing: TICK_SPACING, hooks: IHooks(c.hook)});
    }

    function _admit(string memory j) internal {
        uint256 bank = vm.envUint("DEPOSIT_AGENT_PK");
        vm.startBroadcast(bank);
        PoolAccess.admit(j, bank, vm.parseJsonAddress(j, ".parties.depositAgent"));
        PoolAccess.admit(j, bank, vm.parseJsonAddress(j, ".parties.investorA"));
        PoolAccess.admit(j, bank, vm.parseJsonAddress(j, ".parties.investorB"));
        vm.stopBroadcast();
    }

    function _approve(uint256 pk, Ctx memory c, bool withDeposit) internal {
        vm.startBroadcast(pk);
        IERC20(c.paymentToken).approve(c.permit2, type(uint256).max);
        IAllowanceTransfer(c.permit2).approve(c.paymentToken, c.router, type(uint160).max, type(uint48).max);
        IAllowanceTransfer(c.permit2).approve(c.paymentToken, c.posm, type(uint160).max, type(uint48).max);
        if (withDeposit) {
            IERC20(c.deposit).approve(c.permit2, type(uint256).max);
            IAllowanceTransfer(c.permit2).approve(c.deposit, c.router, type(uint160).max, type(uint48).max);
            IAllowanceTransfer(c.permit2).approve(c.deposit, c.posm, type(uint160).max, type(uint48).max);
        }
        vm.stopBroadcast();
    }

    /// One position around par. On a public network the payment token side is whatever the
    /// Deposit Agent holds, and it bounds the position.
    function _seed(Ctx memory c, PoolKey memory key, uint160 sqrtPriceX96)
        internal
        returns (int24 lower, int24 upper, uint128 liquidity)
    {
        uint256 depositAgentPk = vm.envUint("DEPOSIT_AGENT_PK");
        address depositAgent = vm.addr(depositAgentPk);
        uint256 seedDeposit = Manifest.isLocal() ? LOCAL_SEED_DEPOSIT : NETWORK_SEED_DEPOSIT;
        uint256 seedPayment = IERC20(c.paymentToken).balanceOf(depositAgent);
        uint256 parPayment = seedDeposit * 10 ** c.paymentDecimals / 10 ** c.depositDecimals;
        if (seedPayment > parPayment) seedPayment = parPayment;
        require(seedPayment > 0, "the Deposit Agent holds none of the payment token");

        int24 current = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        lower = _align(current - RANGE_TICKS);
        upper = _align(current + RANGE_TICKS);
        bool adapterIsCurrency0 = Currency.unwrap(key.currency0) == c.adapter;
        (uint256 amount0Max, uint256 amount1Max) =
            adapterIsCurrency0 ? (seedDeposit, seedPayment) : (seedPayment, seedDeposit);
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), amount0Max, amount1Max
        );

        vm.startBroadcast(depositAgentPk);
        IDepositGateway(c.gateway).credit(depositAgent, seedDeposit, "VEN-0002");
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, liquidity, amount0Max, amount1Max, depositAgent, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        IPositionManager(c.posm).modifyLiquidities(abi.encode(actions, params), block.timestamp + 3600);
        vm.stopBroadcast();
        console2.log("liquidity provided by the Deposit Agent:", liquidity);
    }

    function _record(PoolKey memory key, int24 lower, int24 upper, uint160 sqrtPriceX96, uint128 liquidity) internal {
        string memory obj = "pool";
        vm.serializeAddress(obj, "currency0", Currency.unwrap(key.currency0));
        vm.serializeAddress(obj, "currency1", Currency.unwrap(key.currency1));
        vm.serializeUint(obj, "fee", FEE);
        vm.serializeInt(obj, "tickSpacing", TICK_SPACING);
        vm.serializeInt(obj, "tickLower", lower);
        vm.serializeInt(obj, "tickUpper", upper);
        vm.serializeUint(obj, "liquidity", liquidity);
        vm.serializeUint(obj, "sqrtPriceX96", sqrtPriceX96);
        string memory out = vm.serializeAddress(obj, "hook", address(key.hooks));
        vm.writeJson(out, Manifest.path(), ".pool");
    }

    /**
     * @dev sqrt(currency1 base units per currency0 base unit) in Q64.96, at par: one unit of the
     *      deposit for one unit of the payment token. The adapter carries the deposit's decimals.
     */
    function _parPrice(bool depositIsCurrency0, uint256 depositDecimals, uint256 paymentDecimals)
        internal
        pure
        returns (uint160)
    {
        uint256 paymentUnits = 10 ** paymentDecimals;
        uint256 depositUnits = 10 ** depositDecimals;
        (uint256 num, uint256 den) = depositIsCurrency0 ? (paymentUnits, depositUnits) : (depositUnits, paymentUnits);
        return uint160(Math.sqrt(Math.mulDiv(num, 1 << 192, den)));
    }

    function _align(int24 tick) private pure returns (int24) {
        return (tick / TICK_SPACING) * TICK_SPACING;
    }
}
