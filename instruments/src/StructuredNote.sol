// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {CMTATBaseSnapshot} from "debt-standard/modules/0_CMTATBaseSnapshot.sol";
import {SnapshotEngineModule} from "debt-standard/modules/wrapper/extensions/SnapshotEngineModule.sol";
import {HolderListModule} from "debt-standard/modules/wrapper/options/HolderListModule.sol";
import {AdaptedToken} from "./base/AdaptedToken.sol";

/**
 * @title StructuredNote
 * @notice The note: a restricted-transfer security token with snapshot semantics, holder
 *         enumeration and document anchoring, on the adapted composition.
 *
 * - **Units.** Initialised with decimals zero, irrevocably, so a balance is a count of
 *   €1,000 units. Asserted under test.
 * - **Snapshots.** Every balance change notifies the snapshot engine, so the Paying Agent can
 *   read entitlement at a record date that has passed. A transfer settling between record date
 *   and payment date does not alter who is paid.
 * - **Holder list.** Every holder with a non-zero balance is enumerable, for reconciliation
 *   against the Register.
 * - **Documents.** The term sheet is anchored by hash in the token's terms; further documents
 *   through the document module.
 *
 * Economics are not in the token. The payoff, determinations and distributions are separate
 * contracts that read it.
 */
contract StructuredNote is AdaptedToken, CMTATBaseSnapshot, HolderListModule {
    function _update(address from, address to, uint256 amount)
        internal
        virtual
        override(ERC20Upgradeable, CMTATBaseSnapshot, HolderListModule)
    {
        super._update(from, to, amount);
    }

    function _authorizeSnapshots() internal virtual override(SnapshotEngineModule) onlyRole(SNAPSHOOTER_ROLE) {}

    // The ERC-20 surface, resolved onto the adapted composition.

    function approve(address s, uint256 v) public override(ERC20Upgradeable, AdaptedToken) returns (bool) {
        return AdaptedToken.approve(s, v);
    }

    function transfer(address to, uint256 v) public override(ERC20Upgradeable, AdaptedToken) returns (bool) {
        return AdaptedToken.transfer(to, v);
    }

    function transferFrom(address f, address to, uint256 v) public override(ERC20Upgradeable, AdaptedToken) returns (bool) {
        return AdaptedToken.transferFrom(f, to, v);
    }

    function decimals() public view override(ERC20Upgradeable, AdaptedToken) returns (uint8) {
        return AdaptedToken.decimals();
    }

    function name() public view override(ERC20Upgradeable, AdaptedToken) returns (string memory) {
        return AdaptedToken.name();
    }

    function symbol() public view override(ERC20Upgradeable, AdaptedToken) returns (string memory) {
        return AdaptedToken.symbol();
    }
}
