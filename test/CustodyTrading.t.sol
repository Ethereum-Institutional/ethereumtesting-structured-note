// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PermissionFlags} from "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";

import {CustodyAccount} from "../contracts/CustodyAccount.sol";
import {VenueTestBase} from "./VenueTestBase.sol";

/**
 * One Custodian operating segregated client accounts.
 *
 * What is proved is that segregation is real on-chain: each client account is an independent
 * holder, so action against one client cannot touch another. An omnibus wallet cannot give
 * that.
 *
 *   forge test --fork-url http://127.0.0.1:8545 --match-path test/CustodyTrading.t.sol -vv
 */
contract CustodyTradingTest is VenueTestBase {
    address custodian;
    address clientA; // eligible, approved to provide liquidity
    address clientB; // eligible, approved to provide liquidity
    address clientC; // eligible, swap only
    address clientD; // not eligible

    uint128 constant SWAP_IN = 25_000e6;

    function setUp() public override {
        super.setUp();
        custodian = _addr(".custody.custodian");
        clientA = _addr('.custody.accounts["CLIENT-A"]');
        clientB = _addr('.custody.accounts["CLIENT-B"]');
        clientC = _addr('.custody.accounts["CLIENT-C"]');
        clientD = _addr('.custody.accounts["CLIENT-D"]');
    }

    /// The Custodian trades for the client; the client account is the on-chain actor.
    function _custodianTradesFor(address clientAccount, uint128 amountIn) internal {
        vm.prank(custodian);
        CustodyAccount(payable(clientAccount)).executeOne(router, 0, _routerCall(amountIn));
    }

    function _expectCustodianTradeReverts(address clientAccount) internal {
        vm.prank(custodian);
        vm.expectRevert();
        CustodyAccount(payable(clientAccount)).executeOne(router, 0, _routerCall(SWAP_IN));
    }

    /// An eligible client account trades although the client never holds a key.
    function test_custodianTradesForEligibleClient() public {
        uint256 before = asset.balanceOf(clientA);
        _custodianTradesFor(clientA, SWAP_IN);
        uint256 gained = asset.balanceOf(clientA) - before;
        console2.log("CLIENT-A acquired units:", gained);
        assertGt(gained, 0, "a custodied client should be able to trade");
    }

    /// Only the Custodian may operate a client account.
    function test_onlyCustodianCanOperateClientAccount() public {
        bytes memory call_ = _routerCall(SWAP_IN);
        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(CustodyAccount.NotCustodian.selector, address(0xBAD)));
        CustodyAccount(payable(clientA)).executeOne(router, 0, call_);
    }

    /// A client without the venue's liquidity approval may trade but not provide liquidity.
    function test_swapOnlyClient_cannotProvideLiquidity() public {
        assertTrue(_may(clientC, PermissionFlags.SWAP_ALLOWED), "CLIENT-C may swap");
        assertFalse(_may(clientC, PermissionFlags.LIQUIDITY_ALLOWED), "CLIENT-C may not provide liquidity");
        _custodianTradesFor(clientC, 5_000e6);
    }

    /// An account that has not been onboarded is refused, despite cash and approvals in place.
    function test_notOnboardedClient_cannotTrade() public {
        assertGt(IERC20(cash).balanceOf(clientD), 0, "the control account is funded");
        assertTrue(
            checker.checkAllowlist(clientD, address(asset)) == PermissionFlags.NONE,
            "an account not onboarded holds no permission"
        );
        _expectCustodianTradeReverts(clientD);
    }

    /// The segregation property: freezing one client leaves the others trading.
    function test_freezingOneClientDoesNotAffectOthers() public {
        vm.startPrank(agent);
        asset.setFrozenTokens(clientA, asset.balanceOf(clientA));
        vm.stopPrank();

        assertTrue(checker.checkAllowlist(clientA, address(asset)) == PermissionFlags.NONE, "frozen client blocked");
        assertTrue(_may(clientB, PermissionFlags.SWAP_ALLOWED), "sibling client unaffected");

        _expectCustodianTradeReverts(clientA);

        uint256 before = asset.balanceOf(clientB);
        _custodianTradesFor(clientB, SWAP_IN);
        assertGt(asset.balanceOf(clientB), before, "CLIENT-B must still trade");
    }

    /// Recovery from one client only.
    function test_forcedTransferFromSingleClient() public {
        uint256 aBefore = asset.balanceOf(clientA);
        uint256 bBefore = asset.balanceOf(clientB);
        uint256 cBefore = asset.balanceOf(clientC);
        uint256 amount = 1_000e18;

        vm.prank(agent);
        asset.forcedTransfer(clientA, clientB, amount);

        assertEq(asset.balanceOf(clientA), aBefore - amount, "taken from A only");
        assertEq(asset.balanceOf(clientB), bBefore + amount, "delivered to B");
        assertEq(asset.balanceOf(clientC), cBefore, "C untouched");
    }

    /// A forced transfer cannot deliver to an account that is not eligible.
    function test_forcedTransferRefusesIneligibleRecipient() public {
        vm.prank(agent);
        vm.expectRevert();
        asset.forcedTransfer(clientA, clientD, 1_000e18);
    }
}
