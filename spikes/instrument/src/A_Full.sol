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
contract SpikeA_UUPS_Enforcement_HolderList_Snapshot is CMTATBaseHolderList, CMTATBaseSnapshot, UUPSUpgradeable {
    bytes32 public constant PROXY_UPGRADE_ROLE = keccak256("PROXY_UPGRADE_ROLE");
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address f) ERC2771Module(f) { _disableInitializers(); }
    function _authorizeUpgrade(address) internal virtual override(UUPSUpgradeable) onlyRole(PROXY_UPGRADE_ROLE) {}
    function _update(address from, address to, uint256 amount) internal virtual override(CMTATBaseHolderList, CMTATBaseSnapshot) { super._update(from, to, amount); }
    function transfer(address to, uint256 v) public virtual override(ERC20Upgradeable, CMTATBaseHolderList) returns (bool) { return CMTATBaseHolderList.transfer(to, v); }
    function transferFrom(address f, address to, uint256 v) public virtual override(ERC20Upgradeable, CMTATBaseHolderList) returns (bool) { return CMTATBaseHolderList.transferFrom(f, to, v); }
    function approve(address s, uint256 v) public virtual override(ERC20Upgradeable, CMTATBaseHolderList) returns (bool) { return CMTATBaseHolderList.approve(s, v); }
    function decimals() public view virtual override(ERC20Upgradeable, CMTATBaseHolderList) returns (uint8) { return CMTATBaseHolderList.decimals(); }
    function name() public view virtual override(ERC20Upgradeable, CMTATBaseHolderList) returns (string memory) { return CMTATBaseHolderList.name(); }
    function symbol() public view virtual override(ERC20Upgradeable, CMTATBaseHolderList) returns (string memory) { return CMTATBaseHolderList.symbol(); }
    function _msgSender() internal view virtual override(CMTATBaseHolderList, ContextUpgradeable) returns (address) { return CMTATBaseHolderList._msgSender(); }
    function _msgData() internal view virtual override(CMTATBaseHolderList, ContextUpgradeable) returns (bytes calldata) { return CMTATBaseHolderList._msgData(); }
    function _contextSuffixLength() internal view virtual override(CMTATBaseHolderList, ContextUpgradeable) returns (uint256) { return CMTATBaseHolderList._contextSuffixLength(); }
    function _authorizeSnapshots() internal virtual override(SnapshotEngineModule) onlyRole(SNAPSHOOTER_ROLE) {}
}
