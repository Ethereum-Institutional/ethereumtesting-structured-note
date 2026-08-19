// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {DemoBaseline} from "../contracts/DemoBaseline.sol";

/// Deploys the small on-chain pointer the console's reset button reads.
contract DeployOps is Script {
    function run() external {
        uint256 pk = vm.envUint("ISSUER_PK");
        vm.startBroadcast(pk);
        DemoBaseline baseline = new DemoBaseline(vm.addr(pk));
        vm.stopBroadcast();

        console2.log("demoBaseline:", address(baseline));
        string memory obj = "ops";
        string memory out = vm.serializeAddress(obj, "demoBaseline", address(baseline));
        vm.writeJson(out, "ops/addresses.json", ".ops");
    }
}
