// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {PermissionFlags} from "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";

import {ERC3643AllowlistChecker} from "../contracts/ERC3643AllowlistChecker.sol";
import {DemoPermissionedRouter} from "../contracts/DemoPermissionedRouter.sol";
import {CustodyAccount} from "../contracts/CustodyAccount.sol";

interface ITrexAgentActions {
    function setAddressFrozen(address userAddress, bool freeze) external;
    function forcedTransfer(address from, address to, uint256 amount) external returns (bool);
}

/**
 * Custody model: one custodian operating segregated client accounts.
 *
 * The point being proved is that segregation is real on-chain -- each client is an
 * independent holder of record, so issuer action against one client cannot touch another.
 * An omnibus wallet cannot give you this.
 *
 *   forge test --fork-url http://127.0.0.1:8545 --match-path test/CustodyTrading.t.sol -vv
 */
contract CustodyTradingTest is Test {
    address trexToken;
    address usdc;
    address adapter;
    address router;
    address checker;
    address hook;
    address agent;
    address custodian;

    address clientA; // Sakura, JP, professional
    address clientB; // Lion City, SG, professional
    address clientC; // Harbour, HK, retail
    address clientD; // KYC pending

    PoolKey key;
    uint128 constant SWAP_IN = 25_000e6;

    function setUp() public {
        string memory j = vm.readFile("ops/addresses.json");
        trexToken = vm.parseJsonAddress(j, ".trex.token");
        usdc = vm.parseJsonAddress(j, ".venue.usdc");
        adapter = vm.parseJsonAddress(j, ".venue.permissionsAdapter");
        router = vm.parseJsonAddress(j, ".venue.router");
        checker = vm.parseJsonAddress(j, ".venue.allowlistChecker");
        hook = vm.parseJsonAddress(j, ".venue.hook");
        agent = vm.parseJsonAddress(j, ".roles.agent");
        custodian = vm.parseJsonAddress(j, ".custody.custodian");

        clientA = vm.parseJsonAddress(j, '.custody["CLIENT-A"]');
        clientB = vm.parseJsonAddress(j, '.custody["CLIENT-B"]');
        clientC = vm.parseJsonAddress(j, '.custody["CLIENT-C"]');
        clientD = vm.parseJsonAddress(j, '.custody["CLIENT-D"]');

        key = PoolKey({
            currency0: Currency.wrap(vm.parseJsonAddress(j, ".pool.currency0")),
            currency1: Currency.wrap(vm.parseJsonAddress(j, ".pool.currency1")),
            fee: uint24(vm.parseJsonUint(j, ".pool.fee")),
            tickSpacing: int24(vm.parseJsonInt(j, ".pool.tickSpacing")),
            hooks: IHooks(hook)
        });
    }

    function _buyCalldata(uint128 amountIn) internal view returns (bytes memory) {
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

    /// The custodian trades on the client's behalf; the client account is the on-chain actor.
    function _custodianTradesFor(address clientAccount, uint128 amountIn) internal {
        bytes memory routerCall = abi.encodeCall(
            DemoPermissionedRouter.execute, (_buyCalldata(amountIn), block.timestamp + 600)
        );
        vm.prank(custodian);
        CustodyAccount(payable(clientAccount)).executeOne(router, 0, routerCall);
    }

    // ------------------------------------------------------------------ //

    /// A KYC'd client account trades even though the client never touches a key.
    function test_custodianTradesForVerifiedClient() public {
        uint256 before = IERC20(trexToken).balanceOf(clientA);
        _custodianTradesFor(clientA, SWAP_IN);
        uint256 gained = IERC20(trexToken).balanceOf(clientA) - before;
        console2.log("CLIENT-A (Sakura, JP) acquired units:", gained);
        assertGt(gained, 0, "custodied client should be able to trade");
    }

    /// Only the custodian may operate a client account.
    function test_onlyCustodianCanOperateClientAccount() public {
        bytes memory routerCall =
            abi.encodeCall(DemoPermissionedRouter.execute, (_buyCalldata(SWAP_IN), block.timestamp + 600));
        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(CustodyAccount.NotCustodian.selector, address(0xBAD)));
        CustodyAccount(payable(clientA)).executeOne(router, 0, routerCall);
        console2.log("non-custodian rejected by the client account");
    }

    /// A retail client may trade but not provide liquidity.
    function test_retailClient_swapOnly() public {
        ERC3643AllowlistChecker c = ERC3643AllowlistChecker(checker);
        assertTrue(
            (c.checkAllowlist(clientC, trexToken) & PermissionFlags.SWAP_ALLOWED) == PermissionFlags.SWAP_ALLOWED,
            "retail client may swap"
        );
        assertFalse(
            (c.checkAllowlist(clientC, trexToken) & PermissionFlags.LIQUIDITY_ALLOWED)
                == PermissionFlags.LIQUIDITY_ALLOWED,
            "retail client must not LP"
        );
        _custodianTradesFor(clientC, 5_000e6);
        console2.log("CLIENT-C (Harbour, retail): swap ok, LP denied");
    }

    /// An account whose KYC has not completed is blocked, despite funded cash and approvals.
    function test_pendingKycClient_cannotTrade() public {
        assertGt(IERC20(usdc).balanceOf(clientD), 0, "control account is funded");
        assertTrue(
            ERC3643AllowlistChecker(checker).checkAllowlist(clientD, trexToken) == PermissionFlags.NONE,
            "pending-KYC account holds no permissions"
        );

        bytes memory routerCall =
            abi.encodeCall(DemoPermissionedRouter.execute, (_buyCalldata(SWAP_IN), block.timestamp + 600));
        vm.prank(custodian);
        vm.expectRevert();
        CustodyAccount(payable(clientD)).executeOne(router, 0, routerCall);
        console2.log("CLIENT-D (KYC pending): funded and approved, still blocked");
    }

    /// THE segregation property: freezing one client leaves the others trading.
    function test_freezingOneClientDoesNotAffectOthers() public {
        vm.prank(agent);
        ITrexAgentActions(trexToken).setAddressFrozen(clientA, true);

        ERC3643AllowlistChecker c = ERC3643AllowlistChecker(checker);
        assertTrue(c.checkAllowlist(clientA, trexToken) == PermissionFlags.NONE, "frozen client blocked");
        assertTrue(
            (c.checkAllowlist(clientB, trexToken) & PermissionFlags.SWAP_ALLOWED) == PermissionFlags.SWAP_ALLOWED,
            "sibling client unaffected"
        );

        // Frozen client cannot trade...
        bytes memory routerCall =
            abi.encodeCall(DemoPermissionedRouter.execute, (_buyCalldata(SWAP_IN), block.timestamp + 600));
        vm.prank(custodian);
        vm.expectRevert();
        CustodyAccount(payable(clientA)).executeOne(router, 0, routerCall);

        // ...while its sibling under the same custodian carries on.
        uint256 before = IERC20(trexToken).balanceOf(clientB);
        _custodianTradesFor(clientB, SWAP_IN);
        assertGt(IERC20(trexToken).balanceOf(clientB), before, "CLIENT-B must still trade");

        console2.log("CLIENT-A frozen; CLIENT-B under the same custodian traded normally");
    }

    /// Per-client recovery: the issuer can claw back from one client only.
    function test_forcedTransferFromSingleClient() public {
        uint256 aBefore = IERC20(trexToken).balanceOf(clientA);
        uint256 bBefore = IERC20(trexToken).balanceOf(clientB);
        uint256 amount = 1_000e18;

        vm.prank(agent);
        ITrexAgentActions(trexToken).forcedTransfer(clientA, clientB, amount);

        assertEq(IERC20(trexToken).balanceOf(clientA), aBefore - amount, "clawed back from A only");
        assertEq(IERC20(trexToken).balanceOf(clientB), bBefore + amount, "delivered to B");
        console2.log("forced transfer moved 1,000 units from CLIENT-A to CLIENT-B");
    }
}
