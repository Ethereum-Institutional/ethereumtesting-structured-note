// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {CustodyAccount} from "../contracts/CustodyAccount.sol";
import {CustodyAccountFactory} from "../contracts/CustodyAccountFactory.sol";
import {DemoUSDC} from "../contracts/DemoUSDC.sol";

/**
 * Stands up the custodian and its segregated client accounts.
 *
 * Accounts are created and funded here; their *identities* are onboarded by the issuer in
 * trex/scripts/onboard-custody.ts. That ordering is the real-world one: the custodian opens
 * the account, then the issuer's KYC provider attests to it.
 *
 * CLIENT-D is deployed and funded but never onboarded -- the control case that proves the
 * gate is identity, not plumbing.
 */
contract DeployCustody is Script {
    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        uint256 custodianPk = vm.envUint("CUSTODIAN_PK");
        address custodian = vm.addr(custodianPk);

        string memory j = vm.readFile("ops/addresses.json");
        address trexToken = vm.parseJsonAddress(j, ".trex.token");
        address usdc = vm.parseJsonAddress(j, ".venue.usdc");
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

        // Settlement cash for each client account.
        vm.startBroadcast(issuerPk);
        for (uint256 i = 0; i < accts.length; ++i) {
            DemoUSDC(usdc).mint(accts[i], 2_000_000e6);
        }
        vm.stopBroadcast();

        // The custodian sets each account's approvals, batched so it is one action per client.
        vm.startBroadcast(custodianPk);
        for (uint256 i = 0; i < accts.length; ++i) {
            CustodyAccount.Call[] memory calls = new CustodyAccount.Call[](6);
            calls[0] = CustodyAccount.Call(usdc, 0, abi.encodeCall(IERC20.approve, (permit2, type(uint256).max)));
            calls[1] = CustodyAccount.Call(trexToken, 0, abi.encodeCall(IERC20.approve, (permit2, type(uint256).max)));
            calls[2] = CustodyAccount.Call(
                permit2, 0, abi.encodeCall(IAllowanceTransfer.approve, (usdc, router, type(uint160).max, type(uint48).max))
            );
            calls[3] = CustodyAccount.Call(
                permit2,
                0,
                abi.encodeCall(IAllowanceTransfer.approve, (trexToken, router, type(uint160).max, type(uint48).max))
            );
            calls[4] = CustodyAccount.Call(
                permit2, 0, abi.encodeCall(IAllowanceTransfer.approve, (usdc, posm, type(uint160).max, type(uint48).max))
            );
            calls[5] = CustodyAccount.Call(
                permit2,
                0,
                abi.encodeCall(IAllowanceTransfer.approve, (trexToken, posm, type(uint160).max, type(uint48).max))
            );
            CustodyAccount(payable(accts[i])).execute(calls);
        }
        vm.stopBroadcast();

        for (uint256 i = 0; i < accts.length; ++i) {
            console2.log(refs[i], accts[i]);
        }

        string memory obj = "custody";
        vm.serializeAddress(obj, "custodian", custodian);
        vm.serializeAddress(obj, "factory", address(factory));
        vm.serializeString(obj, "custodianName", "Meridian Custody (APAC)");
        vm.serializeAddress(obj, "CLIENT-A", accts[0]);
        vm.serializeAddress(obj, "CLIENT-B", accts[1]);
        vm.serializeAddress(obj, "CLIENT-C", accts[2]);
        string memory out = vm.serializeAddress(obj, "CLIENT-D", accts[3]);
        vm.writeJson(out, "ops/addresses.json", ".custody");
    }
}
