// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Compiles v4-core's PoolManager on the default profile so that its artifact exists for
// deployCode in script/01_DeployVenue.s.sol. Import it nowhere else. See foundry.toml.
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
