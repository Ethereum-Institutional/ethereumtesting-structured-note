// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Test.sol";
import {PermissionFlags} from "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";

import {CustodyAccount} from "../contracts/CustodyAccount.sol";
import {PoolAccess} from "../script/PoolAccess.sol";
import {VenueTestBase} from "./VenueTestBase.sol";

/**
 * One Custodian operating segregated client accounts in the conversion pool.
 *
 * What is proved is that segregation is real on-chain: each client account is an independent
 * holder with its own identity and claims, so action against one client cannot touch another. An
 * omnibus wallet cannot give that. Forced transfer on the deposit is exercised only through the
 * controller's reversal, in the instruments' tests.
 *
 *   forge test --fork-url http://127.0.0.1:8545 --match-path test/CustodyTrading.t.sol -vv
 */
contract CustodyTradingTest is VenueTestBase {
    address custodian;
    address seg1; // onboarded and admitted
    address seg2; // onboarded and admitted
    address seg3; // onboarded to the deposit, not admitted to the pool
    address seg4; // onboarded nowhere

    uint128 constant SWAP_IN = 25_000e6;

    function setUp() public override {
        super.setUp();
        custodian = _addr(".custody.custodian");
        seg1 = _addr('.custody.accounts["SEG-0001"]');
        seg2 = _addr('.custody.accounts["SEG-0002"]');
        seg3 = _addr('.custody.accounts["SEG-0003"]');
        seg4 = _addr('.custody.accounts["SEG-0004"]');
    }

    /// The Custodian converts for the client; the client account is the on-chain actor.
    function _custodianConvertsFor(address account, uint128 amountIn) internal {
        _as(custodian);
        CustodyAccount(payable(account)).executeOne(router, 0, _routerCall(amountIn, true));
    }

    function _expectCustodianConvertReverts(address account) internal {
        bytes memory call_ = _routerCall(SWAP_IN, true);
        _as(custodian);
        vm.expectRevert();
        CustodyAccount(payable(account)).executeOne(router, 0, call_);
    }

    /// An admitted client account converts although the client never holds a key.
    function test_custodianConvertsForAdmittedClient() public {
        uint256 before = deposit.balanceOf(seg1);
        _custodianConvertsFor(seg1, SWAP_IN);
        uint256 gained = deposit.balanceOf(seg1) - before;
        console2.log("SEG-0001 received deposit, cents:", gained);
        assertGt(gained, 0, "a custodied client converts");
    }

    /// Only the Custodian may operate a client account.
    function test_onlyCustodianCanOperateClientAccount() public {
        bytes memory call_ = _routerCall(SWAP_IN, true);
        _as(address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(CustodyAccount.NotCustodian.selector, address(0xBAD)));
        CustodyAccount(payable(seg1)).executeOne(router, 0, call_);
    }

    /// A client account onboarded to the deposit but not admitted to the pool is refused there.
    function test_notAdmittedClient_refusedByThePool() public {
        assertTrue(deposit.canReceive(seg3), "the deposit accepts SEG-0003");
        assertFalse(gate.isAllowed(seg3), "not admitted");
        assertTrue(PoolAccess.identityOf(manifest, seg3) != address(0), "though it has an identity");
        _expectCustodianConvertReverts(seg3);
    }

    /// An account that has not been onboarded is refused, despite funds and approvals in place.
    function test_notOnboardedClient_refused() public {
        assertGt(payment.balanceOf(seg4), 0, "the control account is funded");
        assertTrue(checker.checkAllowlist(seg4, address(deposit)) == PermissionFlags.NONE);
        _expectCustodianConvertReverts(seg4);
    }

    /// The segregation property: freezing one client leaves its sibling converting.
    function test_freezingOneClientDoesNotAffectOthers() public {
        uint256 whole = deposit.balanceOf(seg1);
        _as(depositAgent);
        deposit.setFrozenTokens(seg1, whole);

        assertTrue(checker.checkAllowlist(seg1, address(deposit)) == PermissionFlags.NONE, "frozen client blocked");
        assertTrue(_may(seg2, PermissionFlags.SWAP_ALLOWED), "sibling client unaffected");
        _expectCustodianConvertReverts(seg1);

        uint256 before = deposit.balanceOf(seg2);
        _custodianConvertsFor(seg2, SWAP_IN);
        assertGt(deposit.balanceOf(seg2), before, "SEG-0002 still converts");
    }

    /// Withdrawing one client's pool access leaves its sibling converting.
    function test_withdrawingOneClientsAccessDoesNotAffectOthers() public {
        _as(agentGovernance);
        controller.withdrawPoolAccess(seg1, "Client mandate terminated");
        _expectCustodianConvertReverts(seg1);
        _custodianConvertsFor(seg2, SWAP_IN);
    }
}
