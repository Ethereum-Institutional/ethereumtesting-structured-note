// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IRuleEngine} from "debt-standard/interfaces/engine/IRuleEngine.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {CMTATBaseRuleEngine} from "debt-standard/modules/3_CMTATBaseRuleEngine.sol";
import {CMTATBaseCommon} from "debt-standard/modules/0_CMTATBaseCommon.sol";
import {CMTATBaseAccessControl} from "debt-standard/modules/2_CMTATBaseAccessControl.sol";
import {CMTATBaseSnapshot} from "debt-standard/modules/0_CMTATBaseSnapshot.sol";
import {SnapshotEngineModule} from "debt-standard/modules/wrapper/extensions/SnapshotEngineModule.sol";
import {HolderListModule} from "debt-standard/modules/wrapper/options/HolderListModule.sol";
import {ERC20EnforcementModule} from "debt-standard/modules/wrapper/extensions/ERC20EnforcementModule.sol";
import {ERC20EnforcementERC7551Module} from "debt-standard/modules/wrapper/options/ERC20EnforcementERC7551Module.sol";

contract SpikeF_Lean_Guarded is
    ReentrancyGuardTransient, CMTATBaseRuleEngine, ERC20EnforcementERC7551Module, CMTATBaseSnapshot, HolderListModule, UUPSUpgradeable
{
    bytes32 public constant PROXY_UPGRADE_ROLE = keccak256("PROXY_UPGRADE_ROLE");
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }
    function _authorizeUpgrade(address) internal virtual override(UUPSUpgradeable) onlyRole(PROXY_UPGRADE_ROLE) {}

    function approve(address s, uint256 v) public virtual override(ERC20Upgradeable, CMTATBaseRuleEngine) returns (bool) { return CMTATBaseRuleEngine.approve(s, v); }
    function transfer(address to, uint256 v) public virtual override(ERC20Upgradeable, CMTATBaseCommon) returns (bool) { return CMTATBaseCommon.transfer(to, v); }
    function transferFrom(address f, address to, uint256 v) public virtual override(ERC20Upgradeable, CMTATBaseCommon) returns (bool) { return CMTATBaseCommon.transferFrom(f, to, v); }
    function decimals() public view virtual override(ERC20Upgradeable, CMTATBaseCommon) returns (uint8) { return CMTATBaseCommon.decimals(); }
    function name() public view virtual override(ERC20Upgradeable, CMTATBaseCommon) returns (string memory) { return CMTATBaseCommon.name(); }
    function symbol() public view virtual override(ERC20Upgradeable, CMTATBaseCommon) returns (string memory) { return CMTATBaseCommon.symbol(); }
    function _update(address from, address to, uint256 amount) internal virtual override(ERC20Upgradeable, CMTATBaseSnapshot, HolderListModule) { super._update(from, to, amount); }
    function getFrozenTokens(address a) public view virtual override(ERC20EnforcementModule, ERC20EnforcementERC7551Module) returns (uint256) { return ERC20EnforcementERC7551Module.getFrozenTokens(a); }
    function _authorizeSnapshots() internal virtual override(SnapshotEngineModule) onlyRole(SNAPSHOOTER_ROLE) {}
    function _authorizeERC20Enforcer() internal virtual override(CMTATBaseAccessControl, ERC20EnforcementModule) { CMTATBaseAccessControl._authorizeERC20Enforcer(); }
    function _authorizeForcedTransfer() internal virtual override(CMTATBaseAccessControl, ERC20EnforcementModule) { CMTATBaseAccessControl._authorizeForcedTransfer(); }
    function _callRuleEngineTransferred(IRuleEngine e, address spender, address from, address to, uint256 value) internal virtual override nonReentrant {
        super._callRuleEngineTransferred(e, spender, from, to, value);
    }
}
