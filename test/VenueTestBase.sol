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
import {PoolCredentialRegistry} from "../contracts/PoolCredentialRegistry.sol";
import {Manifest} from "../script/Manifest.sol";

/// The deposit's surface the venue tests drive. It is in the other compilation unit.
interface IDeposit is IERC20 {
    function canSend(address account) external view returns (bool);
    function canReceive(address account) external view returns (bool);
    function pause() external;
    function setAddressFrozen(address account, bool frozen) external;
}

/// The controller's venue acts and Tier 1 withdrawal, in the other compilation unit.
interface IController {
    function withdrawGrant(address account, string calldata reason) external;
    function withdrawPoolAccess(address account, string calldata reason) external;
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
    PoolCredentialRegistry gate;
    IController controller;
    address agentGovernance;
    address servicingWallet;
    address depositAgent;
    address accessIssuer;

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
        gate = PoolCredentialRegistry(_addr(".venue.credentialGate"));
        controller = IController(_addr(".governance.controller"));
        agentGovernance = _addr(".governance.agentGovernance");
        servicingWallet = _addr(".governance.servicingWallet");
        depositAgent = _addr(".parties.depositAgent");
        accessIssuer = _addr(".parties.accessIssuer");

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

    /// The same attestation the deploy scripts write (script/Admission.sol), for a new account.
    function _admit(address account) internal {
        bytes32 entity = keccak256(bytes(vm.parseJsonString(manifest, ".credentialProtocol.corporateIdentitySchema")));
        bytes32 screening = keccak256(bytes(vm.parseJsonString(manifest, ".credentialProtocol.screeningSchema")));
        PoolCredentialRegistry.Attestation memory a = PoolCredentialRegistry.Attestation({
            account: account,
            path: PoolCredentialRegistry.Path.Entity,
            primaryCredential: keccak256(abi.encodePacked(account, "/primary")),
            screeningCredential: keccak256(abi.encodePacked(account, "/screening")),
            primarySchema: entity,
            screeningSchema: screening,
            checks: 1 | 2 | 4,
            jurisdiction: "NL",
            investorClass: 2,
            screenedAt: uint40(block.timestamp - 1 days),
            credentialExpiry: uint40(block.timestamp + 365 days),
            evidence: keccak256("evidence")
        });
        _as(accessIssuer);
        gate.grant(a);
    }
}
