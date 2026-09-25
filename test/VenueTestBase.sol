// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {PermissionFlag} from "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";

import {ERC7943AllowlistChecker} from "../contracts/ERC7943AllowlistChecker.sol";
import {PermissionedSwapRouter} from "../contracts/PermissionedSwapRouter.sol";
import {RestrictedAsset} from "./fixtures/RestrictedAsset.sol";

/**
 * Reads the local deployment from ops/addresses.json. The tests run against it with
 * --fork-url, so each one starts from the deployed state.
 */
abstract contract VenueTestBase is Test {
    string manifest;

    RestrictedAsset asset;
    address cash;
    address adapter;
    address router;
    address posm;
    address permit2;
    ERC7943AllowlistChecker checker;
    address issuer;
    address agent;

    PoolKey key;

    function setUp() public virtual {
        manifest = vm.readFile("ops/addresses.json");
        asset = RestrictedAsset(_addr(".assets.venueAsset.address"));
        cash = _addr(".assets.cash.address");
        adapter = _addr(".venue.permissionsAdapter");
        router = _addr(".venue.router");
        posm = _addr(".venue.positionManager");
        permit2 = _addr(".venue.permit2");
        checker = ERC7943AllowlistChecker(_addr(".venue.allowlistChecker"));
        issuer = _addr(".parties.issuer");
        agent = _addr(".parties.agent");

        key = PoolKey({
            currency0: Currency.wrap(_addr(".pool.currency0")),
            currency1: Currency.wrap(_addr(".pool.currency1")),
            fee: uint24(vm.parseJsonUint(manifest, ".pool.fee")),
            tickSpacing: int24(vm.parseJsonInt(manifest, ".pool.tickSpacing")),
            hooks: IHooks(_addr(".pool.hook"))
        });
    }

    function _addr(string memory path) internal view returns (address) {
        return vm.parseJsonAddress(manifest, path);
    }

    /// @dev Exact-input swap of cash for the asset, in whichever direction the pool's order needs.
    function _buyCalldata(uint128 amountIn) internal view returns (bytes memory) {
        bool zeroForOne = Currency.unwrap(key.currency0) == cash;
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

    function _routerCall(uint128 amountIn) internal view returns (bytes memory) {
        return abi.encodeCall(PermissionedSwapRouter.execute, (_buyCalldata(amountIn), block.timestamp + 600));
    }

    function _may(address account, PermissionFlag flag) internal view returns (bool) {
        return (checker.checkAllowlist(account, address(asset)) & flag) == flag;
    }
}
