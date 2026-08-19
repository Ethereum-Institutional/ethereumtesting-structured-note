// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateView} from "@uniswap/v4-periphery/src/lens/StateView.sol";

/// Deploys the read-only pool state lens the dashboard uses. PoolManager keeps pool state in
/// packed slots reached via `extsload`; StateView exposes it as ordinary view calls.
contract DeployLens is Script {
    function run() external {
        uint256 pk = vm.envUint("ISSUER_PK");
        address poolManager = vm.parseJsonAddress(vm.readFile("ops/addresses.json"), ".venue.poolManager");

        vm.startBroadcast(pk);
        StateView lens = new StateView(IPoolManager(poolManager));
        vm.stopBroadcast();

        console2.log("stateView:", address(lens));
        string memory obj = "lens";
        string memory out = vm.serializeAddress(obj, "stateView", address(lens));
        vm.writeJson(out, "ops/addresses.json", ".lens");
    }
}
