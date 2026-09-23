// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IRuleEngine} from "debt-standard/interfaces/engine/IRuleEngine.sol";
import {IEligibilityGate} from "./IEligibilityGate.sol";
import {ValidationModule} from "debt-standard/modules/wrapper/controllers/ValidationModule.sol";
import {ValidationModuleRuleEngine} from "debt-standard/modules/wrapper/extensions/ValidationModule/ValidationModuleRuleEngine.sol";
import {ERC20EnforcementModuleInternal} from "debt-standard/modules/internal/ERC20EnforcementModuleInternal.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {AccessControlModule} from "debt-standard/modules/wrapper/security/AccessControlModule.sol";
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

contract SpikeH_Adapted is
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
    function _authorizeForcedTransfer() internal virtual override(CMTATBaseAccessControl, ERC20EnforcementModule) onlyRole(FORCED_TRANSFER_ROLE) {}
    function _callRuleEngineTransferred(IRuleEngine e, address spender, address from, address to, uint256 value) internal virtual override nonReentrant {
        super._callRuleEngineTransferred(e, spender, from, to, value);
    }

    // ---- ERC-7943 adaptation ------------------------------------------------------------
    bytes32 public constant FORCED_TRANSFER_ROLE = keccak256("FORCED_TRANSFER_ROLE");
    uint256 private constant GATE_GAS = 100_000;

    /// A gate query that cannot revert: bounded gas, exact return size, strict boolean.
    /// Anything else (no gate code, revert, out of gas, malformed return) answers false.
    function _gateView(bytes memory data) internal view returns (bool ok) {
        address gate = address(ruleEngine());
        if (gate == address(0)) return true;
        assembly ("memory-safe") {
            let success := staticcall(GATE_GAS, gate, add(data, 0x20), mload(data), 0x00, 0x20)
            ok := and(and(success, eq(returndatasize(), 0x20)), eq(mload(0x00), 1))
        }
    }

    function _canSend(address a) internal view virtual override(ValidationModule) returns (bool) {
        return ValidationModule._canSend(a) && _gateView(abi.encodeCall(IEligibilityGate.canSend, (a)));
    }
    function _canReceive(address a) internal view virtual override(ValidationModule) returns (bool) {
        return ValidationModule._canReceive(a) && _gateView(abi.encodeCall(IEligibilityGate.canReceive, (a)));
    }
    function _canTransferWithRuleEngine(address from, address to, uint256 v) internal view virtual override(ValidationModuleRuleEngine) returns (bool) {
        return _endsEligible(from, to) && _gateView(abi.encodeWithSignature("canTransfer(address,address,uint256)", from, to, v));
    }
    function _canTransferFromWithRuleEngine(address sp, address from, address to, uint256 v) internal view virtual override(ValidationModuleRuleEngine) returns (bool) {
        return _endsEligible(from, to) && _gateView(abi.encodeWithSignature("canTransferFrom(address,address,address,uint256)", sp, from, to, v));
    }
    /// A mint has no sender and a burn no recipient; only the real ends are tested.
    function _endsEligible(address from, address to) private view returns (bool) {
        return (from == address(0) || _canSend(from)) && (to == address(0) || _canReceive(to));
    }
    /// Forced transfer may bypass transfer rules but never delivers to an ineligible holder.
    function _forcedTransfer(address from, address to, uint256 v) internal virtual override(ERC20EnforcementModuleInternal) {
        if (to != address(0) && !_canReceive(to)) revert ERC7943CannotReceive(to);
        super._forcedTransfer(from, to, v);
    }
    /// No implicit superuser: the admin administers roles but holds none it was not granted.
    function hasRole(bytes32 role, address account) public view virtual override(AccessControlModule) returns (bool) {
        return AccessControlUpgradeable.hasRole(role, account);
    }
}
