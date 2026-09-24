// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {PermissionFlags} from "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";

import {DemoPermissionedRouter} from "../contracts/DemoPermissionedRouter.sol";
import {VenueTestBase} from "./VenueTestBase.sol";

/**
 * The venue's controls, each shown binding. Every test states a control and shows the
 * transaction succeeding or failing for the right reason.
 *
 *   forge test --fork-url http://127.0.0.1:8545 -vv
 */
contract PermissionedTradingTest is VenueTestBase {
    address investorA; // eligible, approved to provide liquidity
    address investorB; // eligible, swap only
    address investorC; // eligible, approved to provide liquidity
    address investorD; // not eligible

    uint128 constant SWAP_IN = 10_000e6;

    function setUp() public override {
        super.setUp();
        investorA = _addr(".parties.investorA");
        investorB = _addr(".parties.investorB");
        investorC = _addr(".parties.investorC");
        investorD = _addr(".parties.investorD");
    }

    function _buy(address who, uint128 amountIn) internal {
        vm.prank(who);
        DemoPermissionedRouter(payable(router)).execute(_buyCalldata(amountIn), block.timestamp + 600);
    }

    function _expectBuyReverts(address who) internal {
        vm.prank(who);
        vm.expectRevert();
        DemoPermissionedRouter(payable(router)).execute(_buyCalldata(SWAP_IN), block.timestamp + 600);
    }

    /// An eligible investor trades normally.
    function test_eligibleInvestor_canSwap() public {
        uint256 before = asset.balanceOf(investorA);
        _buy(investorA, SWAP_IN);
        uint256 gained = asset.balanceOf(investorA) - before;
        console2.log("investor A bought units:", gained);
        assertGt(gained, 0, "investor A should receive the asset");
    }

    /// Venue approval to provide liquidity is not needed to trade.
    function test_swapOnlyInvestor_canSwap() public {
        uint256 before = asset.balanceOf(investorB);
        _buy(investorB, SWAP_IN);
        assertGt(asset.balanceOf(investorB) - before, 0, "investor B should be able to swap");
    }

    function _mintPlan(address owner) internal view returns (bytes memory) {
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key,
            int24(vm.parseJsonInt(manifest, ".pool.tickLower")),
            int24(vm.parseJsonInt(manifest, ".pool.tickUpper")),
            uint256(1e15),
            type(uint128).max,
            type(uint128).max,
            owner,
            bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        return abi.encode(actions, params);
    }

    /// Providing liquidity needs the venue's approval, and the hook refuses without it. The
    /// same plan succeeds for an approved investor, so the refusal is the permission's.
    function test_swapOnlyInvestor_cannotProvideLiquidity() public {
        assertTrue(_may(investorB, PermissionFlags.SWAP_ALLOWED), "investor B may swap");
        assertFalse(_may(investorB, PermissionFlags.LIQUIDITY_ALLOWED), "investor B may not provide liquidity");

        vm.prank(investorC);
        IPositionManager(posm).modifyLiquidities(_mintPlan(investorC), block.timestamp + 600);

        vm.prank(investorB);
        vm.expectRevert();
        IPositionManager(posm).modifyLiquidities(_mintPlan(investorB), block.timestamp + 600);
    }

    /// An ineligible wallet holds no permission and cannot reach the asset.
    function test_ineligibleWallet_cannotSwap() public {
        assertGt(IERC20(cash).balanceOf(investorD), 0, "investor D is funded");
        assertTrue(
            checker.checkAllowlist(investorD, address(asset)) == PermissionFlags.NONE,
            "investor D must hold no permission"
        );
        _expectBuyReverts(investorD);
    }

    /// Revoking eligibility on the asset stops trading at once, with no venue action.
    function test_revokedEligibility_haltsTrading() public {
        _buy(investorC, SWAP_IN);

        vm.prank(issuer);
        asset.setEligible(investorC, false);

        assertTrue(checker.checkAllowlist(investorC, address(asset)) == PermissionFlags.NONE, "revoked");
        assertTrue(_may(investorA, PermissionFlags.SWAP_ALLOWED), "other investors unaffected");
        _expectBuyReverts(investorC);
    }

    /// A freeze of the whole balance by the Agent stops the wallet trading.
    function test_agentFreeze_haltsTrading() public {
        _buy(investorC, SWAP_IN);

        vm.startPrank(agent);
        asset.setFrozenTokens(investorC, asset.balanceOf(investorC));
        vm.stopPrank();

        assertTrue(checker.checkAllowlist(investorC, address(asset)) == PermissionFlags.NONE, "frozen");
        _expectBuyReverts(investorC);
    }

    /// Pausing the asset halts the whole market.
    function test_assetPause_haltsWholeMarket() public {
        vm.prank(agent);
        asset.pause();

        assertTrue(checker.checkAllowlist(investorA, address(asset)) == PermissionFlags.NONE, "pause blocks all");
        _expectBuyReverts(investorA);
    }

    /// A registered token that does not answer the interface denies rather than reverting.
    function test_checkerFailsClosedOnNonConformingToken() public {
        address noCode = address(0xDEAD);
        address noInterface = cash;
        vm.startPrank(issuer);
        checker.registerAsset(noCode);
        checker.registerAsset(noInterface);
        vm.stopPrank();

        assertTrue(checker.checkAllowlist(investorA, noCode) == PermissionFlags.NONE, "no code denies");
        assertTrue(checker.checkAllowlist(investorA, noInterface) == PermissionFlags.NONE, "no interface denies");
        assertTrue(checker.checkAllowlist(investorA, address(0xBEEF)) == PermissionFlags.NONE, "unregistered denies");
    }
}
