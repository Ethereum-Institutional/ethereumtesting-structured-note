// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";

/// Where the deploy scripts and the venue tests read and write the address manifest.
library Manifest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// The local node's chain id. Anywhere else a network file is required.
    uint256 internal constant LOCAL_CHAIN_ID = 31337;

    /// `ops/addresses.json` unless MANIFEST names another file, as the fork dry run does.
    function path() internal view returns (string memory) {
        return vm.envOr("MANIFEST", string("ops/addresses.json"));
    }

    function read() internal view returns (string memory) {
        return vm.readFile(path());
    }

    function isLocal() internal view returns (bool) {
        return block.chainid == LOCAL_CHAIN_ID;
    }
}
