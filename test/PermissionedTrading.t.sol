// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PermissionFlags} from "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";

import {ERC3643AllowlistChecker} from "../contracts/ERC3643AllowlistChecker.sol";
import {DemoPermissionedRouter} from "../contracts/DemoPermissionedRouter.sol";

interface ITrexAgentActions {
    function setAddressFrozen(address userAddress, bool freeze) external;
    function pause() external;
    function unpause() external;
    function freezePartialTokens(address userAddress, uint256 amount) external;
    function balanceOf(address) external view returns (uint256);
}

/**
 * Behavioural proof that the compliance gates actually bind, run against the live local
 * deployment via --fork-url. Each test states an institutional control and shows the
 * transaction failing (or succeeding) for the right reason.
 *
 *   forge test --fork-url http://127.0.0.1:8545 -vv
 */
contract PermissionedTradingTest is Test {
    address trexToken;
    address usdc;
    address adapter;
    address router;
    address posm;
    address permit2;
    address poolManager;
    address checker;
    address hook;
    address issuer;
    address agent;

    address alice; // SG, verified + professional  -> swap + LP
    address bob; //   HK, verified retail          -> swap only
    address carol; // JP, verified + professional
    address dave; //  no identity                  -> blocked

    PoolKey key;

    uint128 constant SWAP_IN = 10_000e6; // 10,000 USDC

    function setUp() public {
        string memory j = vm.readFile("ops/addresses.json");
        trexToken = vm.parseJsonAddress(j, ".trex.token");
        usdc = vm.parseJsonAddress(j, ".venue.usdc");
        adapter = vm.parseJsonAddress(j, ".venue.permissionsAdapter");
        router = vm.parseJsonAddress(j, ".venue.router");
        posm = vm.parseJsonAddress(j, ".venue.positionManager");
        permit2 = vm.parseJsonAddress(j, ".venue.permit2");
        poolManager = vm.parseJsonAddress(j, ".venue.poolManager");
        checker = vm.parseJsonAddress(j, ".venue.allowlistChecker");
        hook = vm.parseJsonAddress(j, ".venue.hook");
        issuer = vm.parseJsonAddress(j, ".roles.issuer");
        agent = vm.parseJsonAddress(j, ".roles.agent");
        dave = vm.parseJsonAddress(j, ".roles.unverified");

        alice = vm.parseJsonAddress(j, ".investors[0].wallet");
        bob = vm.parseJsonAddress(j, ".investors[1].wallet");
        carol = vm.parseJsonAddress(j, ".investors[2].wallet");

        key = PoolKey({
            currency0: Currency.wrap(vm.parseJsonAddress(j, ".pool.currency0")),
            currency1: Currency.wrap(vm.parseJsonAddress(j, ".pool.currency1")),
            fee: uint24(vm.parseJsonUint(j, ".pool.fee")),
            tickSpacing: int24(vm.parseJsonInt(j, ".pool.tickSpacing")),
            hooks: IHooks(hook)
        });

        _approve(alice);
        _approve(bob);
        _approve(carol);
        _approve(dave);
    }

    function _approve(address who) internal {
        vm.startPrank(who);
        IERC20(usdc).approve(permit2, type(uint256).max);
        IERC20(trexToken).approve(permit2, type(uint256).max);
        IAllowanceTransfer(permit2).approve(usdc, router, type(uint160).max, type(uint48).max);
        IAllowanceTransfer(permit2).approve(trexToken, router, type(uint160).max, type(uint48).max);
        IAllowanceTransfer(permit2).approve(usdc, posm, type(uint160).max, type(uint48).max);
        IAllowanceTransfer(permit2).approve(trexToken, posm, type(uint160).max, type(uint48).max);
        vm.stopPrank();
    }

    /// @dev Buys the permissioned asset with USDC. currency0 is the adapter, so USDC->asset
    ///      is one-for-zero.
    function _buyAssetCalldata(uint128 amountIn) internal view returns (bytes memory) {
        bool zeroForOne = Currency.unwrap(key.currency0) == usdc;
        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: key,
                zeroForOne: zeroForOne,
                amountIn: amountIn,
                amountOutMinimum: 0,
                minHopPriceX36: 0,
                hookData: bytes("")
            })
        );
        params[1] = abi.encode(zeroForOne ? key.currency0 : key.currency1, uint256(amountIn));
        params[2] = abi.encode(zeroForOne ? key.currency1 : key.currency0, uint256(0));
        return abi.encode(actions, params);
    }

    function _buy(address who, uint128 amountIn) internal {
        vm.prank(who);
        DemoPermissionedRouter(payable(router)).execute(_buyAssetCalldata(amountIn), block.timestamp + 600);
    }

    // ------------------------------------------------------------------ //
    //                              Scenarios                             //
    // ------------------------------------------------------------------ //

    /// A verified professional investor trades normally.
    function test_verifiedProfessional_canSwap() public {
        uint256 before = IERC20(trexToken).balanceOf(alice);
        _buy(alice, SWAP_IN);
        uint256 gained = IERC20(trexToken).balanceOf(alice) - before;
        console2.log("Alice (SG, professional) bought units:", gained);
        assertGt(gained, 0, "Alice should receive the asset");
    }

    /// A verified retail investor may trade -- the professional claim only gates LPing.
    function test_verifiedRetail_canSwap() public {
        uint256 before = IERC20(trexToken).balanceOf(bob);
        _buy(bob, SWAP_IN);
        uint256 gained = IERC20(trexToken).balanceOf(bob) - before;
        console2.log("Bob (HK, retail) bought units:", gained);
        assertGt(gained, 0, "Bob should be able to swap");
    }

    /// The venue requires a professional-investor claim to provide liquidity.
    function test_verifiedRetail_cannotProvideLiquidity() public {
        ERC3643AllowlistChecker c = ERC3643AllowlistChecker(checker);
        assertTrue(
            (c.checkAllowlist(bob, trexToken) & PermissionFlags.SWAP_ALLOWED) == PermissionFlags.SWAP_ALLOWED,
            "Bob may swap"
        );
        assertFalse(
            (c.checkAllowlist(bob, trexToken) & PermissionFlags.LIQUIDITY_ALLOWED)
                == PermissionFlags.LIQUIDITY_ALLOWED,
            "Bob must not be allowed to LP"
        );
        console2.log("Bob: SWAP_ALLOWED yes / LIQUIDITY_ALLOWED no");
    }

    /// A wallet with no ONCHAINID cannot touch the asset at all.
    function test_unverifiedWallet_cannotSwap() public {
        assertTrue(
            ERC3643AllowlistChecker(checker).checkAllowlist(dave, trexToken) == PermissionFlags.NONE,
            "Dave must hold no permissions"
        );
        vm.prank(dave);
        vm.expectRevert();
        DemoPermissionedRouter(payable(router)).execute(_buyAssetCalldata(SWAP_IN), block.timestamp + 600);
        console2.log("Dave (no identity): swap reverted as expected");
    }

    /// An agent freeze in T-REX stops the wallet trading, with no venue action.
    function test_agentFreeze_haltsTrading() public {
        _buy(carol, SWAP_IN); // works before the freeze

        vm.prank(agent);
        ITrexAgentActions(trexToken).setAddressFrozen(carol, true);

        assertTrue(
            ERC3643AllowlistChecker(checker).checkAllowlist(carol, trexToken) == PermissionFlags.NONE,
            "frozen wallet must lose all permissions"
        );

        vm.prank(carol);
        vm.expectRevert();
        DemoPermissionedRouter(payable(router)).execute(_buyAssetCalldata(SWAP_IN), block.timestamp + 600);
        console2.log("Carol frozen by agent: swap reverted");
    }

    /// The venue can layer its own jurisdiction rule over the issuer's.
    function test_venueCountryOverlay_blocksJapan() public {
        ERC3643AllowlistChecker c = ERC3643AllowlistChecker(checker);

        vm.startPrank(issuer);
        c.setCountryEnforcement(trexToken, true);
        c.setCountryAllowed(trexToken, 392, false); // Japan off
        vm.stopPrank();

        assertTrue(c.checkAllowlist(carol, trexToken) == PermissionFlags.NONE, "JP investor must be blocked");
        assertTrue(
            (c.checkAllowlist(alice, trexToken) & PermissionFlags.SWAP_ALLOWED) == PermissionFlags.SWAP_ALLOWED,
            "SG investor unaffected"
        );

        vm.prank(carol);
        vm.expectRevert();
        DemoPermissionedRouter(payable(router)).execute(_buyAssetCalldata(SWAP_IN), block.timestamp + 600);
        console2.log("Japan blocked at venue level: Carol reverted, Alice unaffected");
    }

    /// An issuer-level pause halts the whole market.
    function test_issuerPause_haltsWholeMarket() public {
        vm.prank(agent);
        ITrexAgentActions(trexToken).pause();

        ERC3643AllowlistChecker c = ERC3643AllowlistChecker(checker);
        assertTrue(c.checkAllowlist(alice, trexToken) == PermissionFlags.NONE, "pause blocks everyone");

        vm.prank(alice);
        vm.expectRevert();
        DemoPermissionedRouter(payable(router)).execute(_buyAssetCalldata(SWAP_IN), block.timestamp + 600);
        console2.log("Issuer pause: even Alice reverted");
    }
}
