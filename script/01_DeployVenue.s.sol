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
import {IdentityPoolGate, IPoolIdentityRegistry} from "../contracts/IdentityPoolGate.sol";
import {Manifest} from "./Manifest.sol";

/// The deposit is in the other compilation unit; the venue reaches it here.
interface IDepositAllowlist {
    function setAllowlisted(address account, bool allowed) external;
}

interface IDepositGateway {
    function credit(address account, uint256 amount, bytes32 bookingRef) external;
}

/**
 * Deploys the venue around the deposit: the pool manager (locally), the permissioned-pool
 * periphery, the checker, the pool's gate and the compliance hook, and wraps the deposit in its
 * permissions adapter (ADRs 0030, 0031, 0038, 0090).
 *
 * The gate reads the pool's ERC-3643 identity registry, deployed with the scaffolding: a wallet
 * converts when it holds a valid pool-access claim and its recorded country is one the pool
 * serves.
 *
 * The adapter holds the deposit, and Permit2 moves it under allowances. Neither is a client with
 * an identity, so the bank allowlists both on the deposit as infrastructure. The Deposit Agent
 * then credits the adapter one cent, which is what the factory's verification checks, in
 * script/02_ActivateVenue.s.sol.
 *
 * Every venue contract is owned by the deployer until the ceremony hands it to the controller
 * (ADR 0039).
 */
contract DeployVenue is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    struct Venue {
        address manager;
        address weth;
        address factory;
        address checker;
        address gate;
        address hook;
        address router;
        address posm;
        address adapter;
    }

    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        address issuer = vm.addr(issuerPk);

        string memory j = Manifest.read();
        address deposit = vm.parseJsonAddress(j, ".assets.deposit.address");
        address depositAgent = vm.parseJsonAddress(j, ".parties.depositAgent");
        console2.log("deposit        :", deposit);

        vm.startBroadcast(issuerPk);
        Venue memory v = _deploy(issuer, j);
        v.adapter = PermissionsAdapterFactory(v.factory).createPermissionsAdapter(
            IERC20(deposit), issuer, IAllowlistChecker(v.checker)
        );
        ERC7943AllowlistChecker checker = ERC7943AllowlistChecker(v.checker);
        checker.registerAsset(deposit);
        checker.setCredentialGate(deposit, v.gate);
        // The Deposit Agent is the pool's only liquidity provider (ADR 0038).
        checker.setLiquidityRestricted(deposit, true);
        checker.setLiquidityApproved(deposit, depositAgent, true);
        vm.stopBroadcast();

        _allowlistInfrastructure(deposit, v.adapter);

        vm.startBroadcast(vm.envUint("DEPOSIT_AGENT_PK"));
        IDepositGateway(vm.parseJsonAddress(j, ".instruments.gateway")).credit(v.adapter, 1, "VEN-0001");
        vm.stopBroadcast();

        _record(v);
    }

    function _deploy(address issuer, string memory j) internal returns (Venue memory v) {
        // PoolManager and the position manager are deployed from their artifacts rather than
        // imported. foundry.toml restricts the position manager to low optimizer runs for
        // EIP-170, and v4-core's Pool library does not compile at low runs, so the two must
        // never share a compilation unit. On a public network the deployed PoolManager is used.
        v.manager = vm.parseJsonAddress(j, ".network.poolManager");
        if (v.manager == address(0)) {
            v.manager = deployCode("PoolManager.sol:PoolManager", abi.encode(issuer));
        }
        v.weth = vm.parseJsonAddress(j, ".network.weth");
        if (v.weth == address(0)) v.weth = address(new WETH());
        v.factory = address(new PermissionsAdapterFactory(v.manager));
        v.checker = address(new ERC7943AllowlistChecker(issuer));
        v.gate = address(
            new IdentityPoolGate(
                issuer, IPoolIdentityRegistry(vm.parseJsonAddress(j, ".identity.poolRegistry")), _jurisdictions()
            )
        );
        v.hook = _deployHook(v.manager, v.factory);
        v.router = address(
            new PermissionedSwapRouter(
                IPoolManager(v.manager), IAllowanceTransfer(PERMIT2), IPermissionsAdapterFactory(v.factory)
            )
        );
        v.posm = _deployPositionManager(v.manager, v.weth, v.factory);
    }

    /// The 30 states of the European Economic Area, Switzerland and the United Kingdom (ADR 0033),
    /// by ISO 3166-1 numeric code, as the identity storage records countries.
    function _jurisdictions() internal pure returns (uint16[] memory js) {
        uint16[32] memory list = [
            uint16(40), 56, 100, 191, 196, 203, 208, 233, 246, 250, 276, 300, 348, 372, 380, 428,
            440, 442, 470, 528, 616, 620, 642, 703, 705, 724, 752, 352, 438, 578, 756, 826
        ];
        js = new uint16[](list.length);
        for (uint256 k = 0; k < list.length; ++k) {
            js[k] = list[k];
        }
    }

    function _allowlistInfrastructure(address deposit, address adapter) internal {
        vm.startBroadcast(vm.envUint("DEPOSIT_AGENT_PK"));
        IDepositAllowlist(deposit).setAllowlisted(adapter, true);
        IDepositAllowlist(deposit).setAllowlisted(PERMIT2, true);
        vm.stopBroadcast();
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

        // Called explicitly rather than through `new {salt}`: Forge routes a salted `new` through
        // the deterministic deployer on the local node but not on a fork of the test network,
        // where the hook would land at an address whose low bits do not carry its flags.
        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call(
            abi.encodePacked(salt, type(PermissionedComplianceHook).creationCode, hookArgs)
        );
        require(ok && ret.length == 20, "hook deployment failed");
        address hook = address(bytes20(ret));
        require(hook == expectedHook, "hook address mismatch");
        return hook;
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

    function _record(Venue memory v) internal {
        console2.log("poolManager    :", v.manager);
        console2.log("adapterFactory :", v.factory);
        console2.log("checker        :", v.checker);
        console2.log("pool gate      :", v.gate);
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
        vm.serializeAddress(obj, "credentialGate", v.gate);
        vm.serializeAddress(obj, "hook", v.hook);
        vm.serializeAddress(obj, "router", v.router);
        vm.serializeAddress(obj, "positionManager", v.posm);
        string memory out = vm.serializeAddress(obj, "permissionsAdapter", v.adapter);
        vm.writeJson(out, Manifest.path(), ".venue");
    }
}
