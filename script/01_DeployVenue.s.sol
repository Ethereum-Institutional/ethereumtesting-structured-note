// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {WETH} from "solmate/src/tokens/WETH.sol";

import {PermissionsAdapterFactory} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/PermissionsAdapterFactory.sol";
import {IPermissionsAdapterFactory} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IPermissionsAdapterFactory.sol";
import {IAllowlistChecker} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IAllowlistChecker.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";

import {ERC7943AllowlistChecker} from "../contracts/ERC7943AllowlistChecker.sol";
import {PermissionedComplianceHook} from "../contracts/PermissionedComplianceHook.sol";
import {PermissionedSwapRouter} from "../contracts/PermissionedSwapRouter.sol";
import {RestrictedAsset} from "../test/fixtures/RestrictedAsset.sol";

/**
 * Deploys the venue: the pool manager (locally), the permissioned-pool periphery, the
 * checker and the compliance hook, and wraps the permissioned asset in an adapter.
 *
 * Reads the asset from ops/addresses.json and writes the venue addresses back under `venue`.
 *
 * The adapter must be a holder like any other, so the Issuer makes it eligible on the asset
 * and places one base unit in it. That balance is what the factory's verification checks, in
 * script/02_ActivateVenue.s.sol.
 */
contract DeployVenue is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    struct Venue {
        address manager;
        address weth;
        address factory;
        address checker;
        address hook;
        address router;
        address posm;
        address adapter;
    }

    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        address issuer = vm.addr(issuerPk);

        string memory j = vm.readFile("ops/addresses.json");
        address asset = vm.parseJsonAddress(j, ".assets.venueAsset.address");
        console2.log("asset          :", asset);
        console2.log("issuer         :", issuer);

        vm.startBroadcast(issuerPk);
        Venue memory v = _deploy(issuer);

        v.adapter = PermissionsAdapterFactory(v.factory).createPermissionsAdapter(
            IERC20(asset), issuer, IAllowlistChecker(v.checker)
        );
        _configureChecker(ERC7943AllowlistChecker(v.checker), asset, j);

        // The adapter is onboarded as a holder.
        RestrictedAsset(asset).setEligible(v.adapter, true);
        RestrictedAsset(asset).mint(v.adapter, 1);
        vm.stopBroadcast();

        _record(v);
    }

    function _deploy(address issuer) internal returns (Venue memory v) {
        // PoolManager and the position manager are deployed from their artifacts rather than
        // imported. foundry.toml restricts the position manager to low optimizer runs for
        // EIP-170, and v4-core's Pool library does not compile at low runs, so the two must
        // never share a compilation unit. On a public network, pass the canonical PoolManager.
        v.manager = vm.envOr("POOL_MANAGER", address(0));
        if (v.manager == address(0)) {
            v.manager = deployCode("PoolManager.sol:PoolManager", abi.encode(issuer));
        }
        v.weth = address(new WETH());
        v.factory = address(new PermissionsAdapterFactory(v.manager));
        v.checker = address(new ERC7943AllowlistChecker(issuer));
        v.hook = _deployHook(v.manager, v.factory);
        v.router = address(
            new PermissionedSwapRouter(
                IPoolManager(v.manager), IAllowanceTransfer(PERMIT2), IPermissionsAdapterFactory(v.factory)
            )
        );
        v.posm = _deployPositionManager(v.manager, v.weth, v.factory);
    }

    function _deployHook(address manager, address factory) internal returns (address) {
        // The hook address must encode its own permission flags, so mine a CREATE2 salt.
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG
        );
        bytes memory hookArgs = abi.encode(IPoolManager(manager), IPermissionsAdapterFactory(factory));
        (address expectedHook, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(PermissionedComplianceHook).creationCode, hookArgs);

        PermissionedComplianceHook hook = new PermissionedComplianceHook{salt: salt}(
            IPoolManager(manager), IPermissionsAdapterFactory(factory)
        );
        require(address(hook) == expectedHook, "hook address mismatch");
        return address(hook);
    }

    function _deployPositionManager(address manager, address weth, address factory) internal returns (address) {
        // Deployed from its artifact for the same reason as PoolManager: importing it would
        // pull this script, and with it the hook and router, into the low-runs unit, so the
        // bytecode deployed for them would differ from their default build.
        bytes memory args = abi.encode(
            IPoolManager(manager),
            IAllowanceTransfer(PERMIT2),
            300_000,
            IPositionDescriptor(address(0)),
            IWETH9(weth),
            IPermissionsAdapterFactory(factory)
        );
        return deployCode("PermissionedPositionManager.sol:PermissionedPositionManager", args);
    }

    function _configureChecker(ERC7943AllowlistChecker checker, address asset, string memory j) internal {
        // Eligible holders may swap. Providing liquidity also needs the venue's approval,
        // which investors A and C hold and investor B does not.
        checker.registerAsset(asset);
        checker.setLiquidityRestricted(asset, true);
        checker.setLiquidityApproved(asset, vm.parseJsonAddress(j, ".parties.investorA"), true);
        checker.setLiquidityApproved(asset, vm.parseJsonAddress(j, ".parties.investorC"), true);
    }

    function _record(Venue memory v) internal {
        console2.log("poolManager    :", v.manager);
        console2.log("adapterFactory :", v.factory);
        console2.log("checker        :", v.checker);
        console2.log("hook           :", v.hook);
        console2.log("router         :", v.router);
        console2.log("positionManager:", v.posm);
        console2.log("adapter        :", v.adapter);

        string memory obj = "venue";
        vm.serializeAddress(obj, "poolManager", v.manager);
        vm.serializeAddress(obj, "weth", v.weth);
        vm.serializeAddress(obj, "permit2", PERMIT2);
        vm.serializeAddress(obj, "adapterFactory", v.factory);
        vm.serializeAddress(obj, "allowlistChecker", v.checker);
        vm.serializeAddress(obj, "hook", v.hook);
        vm.serializeAddress(obj, "router", v.router);
        vm.serializeAddress(obj, "positionManager", v.posm);
        string memory out = vm.serializeAddress(obj, "permissionsAdapter", v.adapter);
        vm.writeJson(out, "ops/addresses.json", ".venue");
    }
}
