// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {Scaffolding} from "./Scaffolding.sol";
import {Programme} from "./Programme.sol";
import {Manifest} from "./Manifest.sol";

/**
 * The governance ceremony, last: the pool's identity registries and, where the pool is
 * deployed, the venue handed to the governance controller; the pool's gate supervised by it; and
 * the deployer's renunciation of the deposit's and the gateway's administration, which the
 * controller already shares. Every note is the controller's from the moment it is issued, so the
 * notes need nothing here.
 *
 * Run from instruments/ after IssueNote.
 */
contract Ceremony is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("ISSUER_PK");
        string memory j = vm.readFile(_manifest());
        Scaffolding.Deployed memory d = Manifest.scaffolding(j);
        Programme.Deployed memory p = Manifest.programme(j);

        vm.startBroadcast(deployerPk);
        Programme.ceremony(d, p, _venue(j), vm.addr(deployerPk));
        vm.stopBroadcast();
        console2.log("the deployer has renounced; the controller governs:", address(p.controller));
    }

    function _venue(string memory j) private view returns (Programme.Venue memory) {
        if (!vm.keyExistsJson(j, ".venue.allowlistChecker")) return Programme.Venue(address(0), address(0), address(0));
        return Programme.Venue({
            checker: vm.parseJsonAddress(j, ".venue.allowlistChecker"),
            adapter: vm.parseJsonAddress(j, ".venue.permissionsAdapter"),
            credentialGate: vm.parseJsonAddress(j, ".venue.credentialGate")
        });
    }

    function _manifest() private view returns (string memory) {
        return string.concat("../", vm.envOr("MANIFEST", string("ops/addresses.json")));
    }
}
