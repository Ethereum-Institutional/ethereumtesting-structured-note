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

import {ERC3643AllowlistChecker} from "../contracts/ERC3643AllowlistChecker.sol";
import {PermissionedComplianceHook} from "../contracts/PermissionedComplianceHook.sol";
import {DemoPermissionedRouter} from "../contracts/DemoPermissionedRouter.sol";
import {DemoUSDC} from "../contracts/DemoUSDC.sol";

/**
 * Deploys the trading venue: Uniswap v4 plus the permissioned-pool contracts, the
 * ERC-3643 identity bridge, and the compliance hook.
 *
 * Reads the already-deployed ERC-3643 token from ops/addresses.json and writes the
 * venue addresses back under the `venue` key.
 *
 * The adapter is created here but NOT yet verified: verification requires the adapter
 * to hold a non-zero balance of the permissioned token, which is only possible once the
 * issuer has registered the adapter in the identity registry. That handshake is
 * trex/scripts/register-adapter.ts, followed by script/02_ActivateVenue.s.sol.
 */
contract DeployVenue is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    /// @dev Claim topic a wallet must hold to provide liquidity (professional investor).
    uint256 constant LIQUIDITY_CLAIM_TOPIC = 42;

    struct Venue {
        address manager;
        address weth;
        address usdc;
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

        string memory addrs = vm.readFile("ops/addresses.json");
        address trexToken = vm.parseJsonAddress(addrs, ".trex.token");
        console2.log("ERC-3643 token :", trexToken);
        console2.log("issuer         :", issuer);

        vm.startBroadcast(issuerPk);
        Venue memory v = _deploy(issuer);

        // Wrap the ERC-3643 token for pool trading.
        v.adapter = PermissionsAdapterFactory(v.factory).createPermissionsAdapter(
            IERC20(trexToken), issuer, IAllowlistChecker(v.checker)
        );
        _configureChecker(ERC3643AllowlistChecker(v.checker), trexToken);
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
        v.usdc = address(new DemoUSDC(issuer));
        v.factory = address(new PermissionsAdapterFactory(v.manager));
        v.checker = address(new ERC3643AllowlistChecker(issuer));
        v.hook = _deployHook(v.manager, v.factory);
        v.router = address(
            new DemoPermissionedRouter(
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

    function _configureChecker(ERC3643AllowlistChecker checker, address trexToken) internal {
        // Teach the bridge about this asset: verified holders may swap; LPing additionally
        // requires the professional-investor claim.
        checker.registerAsset(trexToken, LIQUIDITY_CLAIM_TOPIC);

        // Pre-load the venue jurisdiction overlay (enforcement stays OFF until toggled).
        uint16[] memory apac = new uint16[](4);
        apac[0] = 702; // Singapore
        apac[1] = 344; // Hong Kong
        apac[2] = 392; // Japan
        apac[3] = 36; // Australia
        checker.setCountriesAllowed(trexToken, apac, true);
    }

    function _record(Venue memory v) internal {
        console2.log("poolManager    :", v.manager);
        console2.log("adapterFactory :", v.factory);
        console2.log("checker        :", v.checker);
        console2.log("hook           :", v.hook);
        console2.log("router         :", v.router);
        console2.log("positionManager:", v.posm);
        console2.log("usdc           :", v.usdc);
        console2.log("adapter        :", v.adapter);

        string memory obj = "venue";
        vm.serializeAddress(obj, "poolManager", v.manager);
        vm.serializeAddress(obj, "weth", v.weth);
        vm.serializeAddress(obj, "usdc", v.usdc);
        vm.serializeAddress(obj, "permit2", PERMIT2);
        vm.serializeAddress(obj, "adapterFactory", v.factory);
        vm.serializeAddress(obj, "allowlistChecker", v.checker);
        vm.serializeAddress(obj, "hook", v.hook);
        vm.serializeAddress(obj, "router", v.router);
        vm.serializeAddress(obj, "positionManager", v.posm);
        vm.serializeUint(obj, "liquidityClaimTopic", LIQUIDITY_CLAIM_TOPIC);
        string memory out = vm.serializeAddress(obj, "permissionsAdapter", v.adapter);
        vm.writeJson(out, "ops/addresses.json", ".venue");
    }
}
