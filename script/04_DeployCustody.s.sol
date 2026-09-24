// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {CustodyAccount} from "../contracts/CustodyAccount.sol";
import {CustodyAccountFactory} from "../contracts/CustodyAccountFactory.sol";
import {ERC7943AllowlistChecker} from "../contracts/ERC7943AllowlistChecker.sol";
import {RestrictedAsset} from "../test/fixtures/RestrictedAsset.sol";
import {TestCash} from "../test/fixtures/TestCash.sol";

/**
 * Stands up the Custodian and its segregated client accounts, then has the Issuer onboard
 * them. That ordering is the real one: the Custodian opens the account, then the Issuer
 * accepts it as a holder.
 *
 * CLIENT-D is opened and funded but never made eligible: the control case, whose refusal can
 * only come from the gate.
 */
contract DeployCustody is Script {
    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        uint256 custodianPk = vm.envUint("CUSTODIAN_PK");
        address custodian = vm.addr(custodianPk);

        string memory j = vm.readFile("ops/addresses.json");
        address asset = vm.parseJsonAddress(j, ".assets.venueAsset.address");
        address cash = vm.parseJsonAddress(j, ".assets.cash.address");
        address checker = vm.parseJsonAddress(j, ".venue.allowlistChecker");
        address permit2 = vm.parseJsonAddress(j, ".venue.permit2");
        address router = vm.parseJsonAddress(j, ".venue.router");
        address posm = vm.parseJsonAddress(j, ".venue.positionManager");

        string[4] memory refs = ["CLIENT-A", "CLIENT-B", "CLIENT-C", "CLIENT-D"];

        vm.startBroadcast(custodianPk);
        CustodyAccountFactory factory = new CustodyAccountFactory(custodian);
        address[] memory accts = new address[](refs.length);
        for (uint256 i = 0; i < refs.length; ++i) {
            accts[i] = factory.createAccount(refs[i]);
        }
        vm.stopBroadcast();

        console2.log("custodian      :", custodian);
        console2.log("custody factory:", address(factory));

        // The Issuer onboards A to C, allocates to them, and approves A and B to provide
        // liquidity. Every account receives cash.
        uint256[3] memory allocation = [uint256(120_000e18), 80_000e18, 45_000e18];
        vm.startBroadcast(issuerPk);
        for (uint256 i = 0; i < accts.length; ++i) {
            TestCash(cash).mint(accts[i], 2_000_000e6);
        }
        for (uint256 i = 0; i < 3; ++i) {
            RestrictedAsset(asset).setEligible(accts[i], true);
            RestrictedAsset(asset).mint(accts[i], allocation[i]);
        }
        ERC7943AllowlistChecker(checker).setLiquidityApproved(asset, accts[0], true);
        ERC7943AllowlistChecker(checker).setLiquidityApproved(asset, accts[1], true);
        vm.stopBroadcast();

        // The Custodian sets each account's approvals, batched as one action per client.
        vm.startBroadcast(custodianPk);
        for (uint256 i = 0; i < accts.length; ++i) {
            CustodyAccount.Call[] memory calls = new CustodyAccount.Call[](6);
            calls[0] = CustodyAccount.Call(cash, 0, abi.encodeCall(IERC20.approve, (permit2, type(uint256).max)));
            calls[1] = CustodyAccount.Call(asset, 0, abi.encodeCall(IERC20.approve, (permit2, type(uint256).max)));
            calls[2] = CustodyAccount.Call(
                permit2, 0, abi.encodeCall(IAllowanceTransfer.approve, (cash, router, type(uint160).max, type(uint48).max))
            );
            calls[3] = CustodyAccount.Call(
                permit2, 0, abi.encodeCall(IAllowanceTransfer.approve, (asset, router, type(uint160).max, type(uint48).max))
            );
            calls[4] = CustodyAccount.Call(
                permit2, 0, abi.encodeCall(IAllowanceTransfer.approve, (cash, posm, type(uint160).max, type(uint48).max))
            );
            calls[5] = CustodyAccount.Call(
                permit2, 0, abi.encodeCall(IAllowanceTransfer.approve, (asset, posm, type(uint160).max, type(uint48).max))
            );
            CustodyAccount(payable(accts[i])).execute(calls);
        }
        vm.stopBroadcast();

        string memory a = "accounts";
        for (uint256 i = 0; i < accts.length; ++i) {
            console2.log(refs[i], accts[i]);
            vm.serializeAddress(a, refs[i], accts[i]);
        }
        string memory accounts = vm.serializeAddress(a, refs[refs.length - 1], accts[refs.length - 1]);

        string memory obj = "custody";
        vm.serializeAddress(obj, "custodian", custodian);
        vm.serializeAddress(obj, "factory", address(factory));
        string memory out = vm.serializeString(obj, "accounts", accounts);
        vm.writeJson(out, "ops/addresses.json", ".custody");
    }
}
