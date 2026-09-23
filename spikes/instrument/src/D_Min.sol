// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC2771Module} from "debt-standard/modules/wrapper/options/ERC2771Module.sol";
import {CMTATBaseERC7551Enforcement} from "debt-standard/modules/7_CMTATBaseERC7551Enforcement.sol";
import {CMTATBaseHolderList} from "debt-standard/modules/8_CMTATBaseHolderList.sol";
import {CMTATBaseSnapshot} from "debt-standard/modules/0_CMTATBaseSnapshot.sol";
import {CMTATBaseERC20CrossChain} from "debt-standard/modules/5_CMTATBaseERC20CrossChain.sol";
import {SnapshotEngineModule} from "debt-standard/modules/wrapper/extensions/SnapshotEngineModule.sol";
contract SpikeD_UUPS_Enforcement is CMTATBaseERC7551Enforcement, UUPSUpgradeable {
    bytes32 public constant PROXY_UPGRADE_ROLE = keccak256("PROXY_UPGRADE_ROLE");
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address f) ERC2771Module(f) { _disableInitializers(); }
    function _authorizeUpgrade(address) internal virtual override(UUPSUpgradeable) onlyRole(PROXY_UPGRADE_ROLE) {}
}
