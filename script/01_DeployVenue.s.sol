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
import {PoolCredentialRegistry} from "../contracts/PoolCredentialRegistry.sol";
import {ICredentialIssuers, ICredentialRevocations} from "../contracts/interfaces/ICredentialProtocol.sol";
import {Manifest} from "./Manifest.sol";

/// The instruments are in the other compilation unit; the venue reaches them here.
interface IIdentityRegistryWriter {
    function HOLD() external view returns (uint32);
    function RECEIVE() external view returns (uint32);
    function TRANSFER() external view returns (uint32);
    function SANCTIONS_CLEAR() external view returns (uint32);
    function CONTRACT_ACCOUNT() external view returns (uint32);
    function SETTLEMENT() external view returns (uint32);
    function grant(address account, uint32 flags, uint16 jurisdiction, uint40 expiresAt, bytes32 ref, bytes32 commitment)
        external;
}

interface IDepositGateway {
    function credit(address account, uint256 amount, bytes32 bookingRef) external;
}

/**
 * Deploys the venue around the deposit: the pool manager (locally), the permissioned-pool
 * periphery, the checker, the pool's credential gate and the compliance hook, and wraps the
 * deposit in its permissions adapter (ADRs 0030, 0031, 0038).
 *
 * The adapter holds the deposit, and Permit2 moves it under allowances, so the Access Issuer
 * onboards both to the Identity Registry: the adapter as a contract holder, Permit2 with the
 * settlement right only (ADR 0013). The Deposit Agent then credits the adapter one cent, which is
 * what the factory's verification checks, in script/02_ActivateVenue.s.sol.
 *
 * Every venue contract is owned by the deployer until the ceremony hands it to the controller
 * (ADR 0039). The credential gate's attester is the Access Issuer.
 */
contract DeployVenue is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint40 constant POOL_MAX_VALIDITY = 90 days;
    uint40 constant SCREENING_MAX_AGE = 30 days;
    uint40 constant INFRASTRUCTURE_GRANT = 180 days;

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

        _onboardInfrastructure(j, v.adapter);

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
        v.gate = address(new PoolCredentialRegistry(_policy(issuer, j)));
        v.hook = _deployHook(v.manager, v.factory);
        v.router = address(
            new PermissionedSwapRouter(
                IPoolManager(v.manager), IAllowanceTransfer(PERMIT2), IPermissionsAdapterFactory(v.factory)
            )
        );
        v.posm = _deployPositionManager(v.manager, v.weth, v.factory);
    }

    /// The pool's credential policy (ADRs 0032 to 0035).
    function _policy(address issuer, string memory j) internal view returns (PoolCredentialRegistry.Config memory c) {
        uint32 walletControl = 1 << 0;
        uint32 notExpired = 1 << 1;
        uint32 entityActive = 1 << 2;
        uint32 over18 = 1 << 3;
        uint32 sanctionsClean = 1 << 4;
        uint32 notPep = 1 << 5;
        bytes32 screening = keccak256(bytes(vm.parseJsonString(j, ".credentialProtocol.screeningSchema")));
        c = PoolCredentialRegistry.Config({
            admin: issuer,
            attester: vm.parseJsonAddress(j, ".parties.accessIssuer"),
            issuers: ICredentialIssuers(vm.parseJsonAddress(j, ".credentialProtocol.issuers")),
            revocations: ICredentialRevocations(vm.parseJsonAddress(j, ".credentialProtocol.revocations")),
            issuerDid: vm.parseJsonString(j, ".credentialProtocol.issuerDid"),
            entity: PoolCredentialRegistry.PathPolicy(
                keccak256(bytes(vm.parseJsonString(j, ".credentialProtocol.corporateIdentitySchema"))),
                screening,
                walletControl | notExpired | entityActive
            ),
            person: PoolCredentialRegistry.PathPolicy(
                keccak256(bytes(vm.parseJsonString(j, ".credentialProtocol.passportSchema"))),
                screening,
                walletControl | notExpired | over18 | sanctionsClean | notPep
            ),
            jurisdictions: _jurisdictions(),
            investorClasses: uint8(1 << 1 | 1 << 2), // professional, institutional
            maxValidity: POOL_MAX_VALIDITY,
            screeningMaxAge: SCREENING_MAX_AGE,
            rootFreshness: 0
        });
    }

    /// The 30 states of the European Economic Area, Switzerland and the United Kingdom (ADR 0033).
    function _jurisdictions() internal pure returns (bytes2[] memory js) {
        bytes2[32] memory list = [
            bytes2("AT"), "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV",
            "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH", "GB"
        ];
        js = new bytes2[](list.length);
        for (uint256 k = 0; k < list.length; ++k) {
            js[k] = list[k];
        }
    }

    function _onboardInfrastructure(string memory j, address adapter) internal {
        IIdentityRegistryWriter r = IIdentityRegistryWriter(vm.parseJsonAddress(j, ".instruments.registry"));
        vm.startBroadcast(vm.envUint("ACCESS_ISSUER_PK"));
        uint40 until = uint40(block.timestamp) + INFRASTRUCTURE_GRANT;
        uint32 contractHolder = r.HOLD() | r.RECEIVE() | r.TRANSFER() | r.SANCTIONS_CLEAR() | r.CONTRACT_ACCOUNT();
        r.grant(adapter, contractHolder, 276, until, "ONB-0009", bytes32(0));
        r.grant(PERMIT2, r.SETTLEMENT() | r.SANCTIONS_CLEAR() | r.CONTRACT_ACCOUNT(), 276, until, "ONB-0010", bytes32(0));
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
        console2.log("credential gate:", v.gate);
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
