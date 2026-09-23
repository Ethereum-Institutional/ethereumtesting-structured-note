// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Compiles the permissioned position manager on its low-runs restriction so that its
// artifact exists for deployCode in script/01_DeployVenue.s.sol. Import it nowhere else,
// or the importing file joins the low-runs unit. See foundry.toml.
import {PermissionedPositionManager} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/PermissionedPositionManager.sol";
