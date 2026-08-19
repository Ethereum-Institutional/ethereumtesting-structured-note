// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
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
import {PermissionedPositionManager} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/PermissionedPositionManager.sol";
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

    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        address issuer = vm.addr(issuerPk);

        string memory addrs = vm.readFile("ops/addresses.json");
        address trexToken = vm.parseJsonAddress(addrs, ".trex.token");
        console2.log("ERC-3643 token :", trexToken);
        console2.log("issuer         :", issuer);

        vm.startBroadcast(issuerPk);

        PoolManager manager = new PoolManager(issuer);
        WETH weth = new WETH();
        DemoUSDC usdc = new DemoUSDC(issuer);
        PermissionsAdapterFactory factory = new PermissionsAdapterFactory(address(manager));
        ERC3643AllowlistChecker checker = new ERC3643AllowlistChecker(issuer);

        // The hook address must encode its own permission flags, so mine a CREATE2 salt.
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG
        );
        bytes memory hookArgs = abi.encode(IPoolManager(address(manager)), IPermissionsAdapterFactory(address(factory)));
        (address expectedHook, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(PermissionedComplianceHook).creationCode, hookArgs);

        PermissionedComplianceHook hook = new PermissionedComplianceHook{salt: salt}(
            IPoolManager(address(manager)), IPermissionsAdapterFactory(address(factory))
        );
        require(address(hook) == expectedHook, "hook address mismatch");

        DemoPermissionedRouter router = new DemoPermissionedRouter(
            IPoolManager(address(manager)), IAllowanceTransfer(PERMIT2), IPermissionsAdapterFactory(address(factory))
        );

        PermissionedPositionManager posm = new PermissionedPositionManager(
            IPoolManager(address(manager)),
            IAllowanceTransfer(PERMIT2),
            300_000,
            IPositionDescriptor(address(0)),
            IWETH9(address(weth)),
            IPermissionsAdapterFactory(address(factory))
        );

        // Wrap the ERC-3643 token for pool trading.
        address adapter = factory.createPermissionsAdapter(
            IERC20(trexToken), issuer, IAllowlistChecker(address(checker))
        );

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

        vm.stopBroadcast();

        console2.log("poolManager    :", address(manager));
        console2.log("adapterFactory :", address(factory));
        console2.log("checker        :", address(checker));
        console2.log("hook           :", address(hook));
        console2.log("router         :", address(router));
        console2.log("positionManager:", address(posm));
        console2.log("usdc           :", address(usdc));
        console2.log("adapter        :", adapter);

        string memory obj = "venue";
        vm.serializeAddress(obj, "poolManager", address(manager));
        vm.serializeAddress(obj, "weth", address(weth));
        vm.serializeAddress(obj, "usdc", address(usdc));
        vm.serializeAddress(obj, "permit2", PERMIT2);
        vm.serializeAddress(obj, "adapterFactory", address(factory));
        vm.serializeAddress(obj, "allowlistChecker", address(checker));
        vm.serializeAddress(obj, "hook", address(hook));
        vm.serializeAddress(obj, "router", address(router));
        vm.serializeAddress(obj, "positionManager", address(posm));
        vm.serializeUint(obj, "liquidityClaimTopic", LIQUIDITY_CLAIM_TOPIC);
        string memory out = vm.serializeAddress(obj, "permissionsAdapter", adapter);
        vm.writeJson(out, "ops/addresses.json", ".venue");
    }
}
