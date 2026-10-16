// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {PermissionFlag} from "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";

import {ERC7943AllowlistChecker} from "../contracts/ERC7943AllowlistChecker.sol";
import {PermissionedSwapRouter} from "../contracts/PermissionedSwapRouter.sol";
import {IdentityPoolGate} from "../contracts/IdentityPoolGate.sol";
import {Manifest} from "../script/Manifest.sol";
import {PoolAccess} from "../script/PoolAccess.sol";

/// The deposit's surface the venue tests drive. It is in the other compilation unit.
interface IDeposit is IERC20 {
    function canSend(address account) external view returns (bool);
    function canReceive(address account) external view returns (bool);
    function pause() external;
    function setFrozenTokens(address account, uint256 amount) external;
    function setAllowlisted(address account, bool allowed) external;
}

/// A claim issuer, which can revoke a claim by its signature.
interface IClaimIssuer {
    function revokeClaimBySignature(bytes calldata signature) external;
}

/// An ONCHAINID identity's claims.
interface IClaims {
    function getClaim(bytes32 claimId)
        external
        view
        returns (uint256 topic, uint256 scheme, address issuer, bytes memory signature, bytes memory data, string memory uri);
}

/// The pool's identity registry's trusted issuers, which only the controller may change.
interface ITrustedIssuers {
    function removeTrustedIssuer(address issuer) external;
}

/// The controller's venue acts and Tier 1 withdrawal, in the other compilation unit.
interface IController {
    function freezeAccount(address[] calldata tokens, address account, bool frozen, string calldata reason) external;
    function withdrawPoolAccess(address account, string calldata reason) external;
    function restorePoolAccess(address account, string calldata reason) external;
    function setVenueSwapping(bool enabled) external;
    function credentialGate() external view returns (address);
}

/**
 * Reads the deployment from the manifest (ops/addresses.json, or the file MANIFEST names). The
 * tests run against it with --fork-url, so each one starts from the deployed state: after the
 * ceremony, with the venue governed by the controller.
 */
abstract contract VenueTestBase is Test {
    string manifest;

    IDeposit deposit;
    IERC20 payment;
    address adapter;
    address router;
    address posm;
    address permit2;
    ERC7943AllowlistChecker checker;
    IdentityPoolGate gate;
    IController controller;
    address agentGovernance;
    address servicingWallet;
    address depositAgent;

    PoolKey key;

    function setUp() public virtual {
        manifest = Manifest.read();
        deposit = IDeposit(_addr(".assets.deposit.address"));
        payment = IERC20(_addr(".assets.paymentToken.address"));
        adapter = _addr(".venue.permissionsAdapter");
        router = _addr(".venue.router");
        posm = _addr(".venue.positionManager");
        permit2 = _addr(".venue.permit2");
        checker = ERC7943AllowlistChecker(_addr(".venue.allowlistChecker"));
        gate = IdentityPoolGate(_addr(".venue.credentialGate"));
        controller = IController(_addr(".governance.controller"));
        agentGovernance = _addr(".governance.agentGovernance");
        servicingWallet = _addr(".governance.servicingWallet");
        depositAgent = _addr(".parties.depositAgent");

        key = PoolKey({
            currency0: Currency.wrap(_addr(".pool.currency0")),
            currency1: Currency.wrap(_addr(".pool.currency1")),
            fee: uint24(vm.parseJsonUint(manifest, ".pool.fee")),
            tickSpacing: int24(vm.parseJsonInt(manifest, ".pool.tickSpacing")),
            hooks: IHooks(_addr(".pool.hook"))
        });
    }

    /// @dev Pranks `who`, first giving it ether if it has none. On a fork of an OP-stack network
    ///      Forge charges a pranked call a fee the caller must be able to pay, so a contract wallet
    ///      or a fresh address with no balance reverts before any code runs (ADR 0041).
    function _as(address who) internal {
        if (who.balance == 0) vm.deal(who, 1 ether);
        vm.prank(who);
    }

    function _addr(string memory path) internal view returns (address) {
        return vm.parseJsonAddress(manifest, path);
    }

    /// Exact-input conversion. `intoDeposit`: pay the payment token, receive the deposit.
    function _swapCalldata(uint128 amountIn, bool intoDeposit) internal view returns (bytes memory) {
        address paid = intoDeposit ? address(payment) : adapter;
        bool zeroForOne = Currency.unwrap(key.currency0) == paid;
        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: key,
                zeroForOne: zeroForOne,
                amountIn: amountIn,
                amountOutMinimum: 0,
                minHopPriceX36: 0,
                hookData: bytes("")
            })
        );
        params[1] = abi.encode(zeroForOne ? key.currency0 : key.currency1, uint256(amountIn));
        params[2] = abi.encode(zeroForOne ? key.currency1 : key.currency0, uint256(0));
        return abi.encode(actions, params);
    }

    function _routerCall(uint128 amountIn, bool intoDeposit) internal view returns (bytes memory) {
        return abi.encodeCall(PermissionedSwapRouter.execute, (_swapCalldata(amountIn, intoDeposit), block.timestamp + 600));
    }

    function _may(address account, PermissionFlag flag) internal view returns (bool) {
        return (checker.checkAllowlist(account, address(deposit)) & flag) == flag;
    }

    /// The bank's pool-access claim on the wallet's identity, as the deploy scripts write it
    /// (script/PoolAccess.sol).
    function _admit(address account) internal {
        if (depositAgent.balance == 0) vm.deal(depositAgent, 1 ether);
        vm.startPrank(depositAgent);
        PoolAccess.admit(manifest, vm.envUint("DEPOSIT_AGENT_PK"), account);
        vm.stopPrank();
    }

    /// The pool-access claim the bank's issuer gave `account`.
    function _poolClaim(address account) internal view returns (bytes memory signature, bytes memory data) {
        address issuer = _addr(".identity.bankIssuer");
        bytes32 claimId = keccak256(abi.encode(issuer, PoolAccess.TOPIC));
        (,,, signature, data,) = IClaims(PoolAccess.identityOf(manifest, account)).getClaim(claimId);
    }
}
