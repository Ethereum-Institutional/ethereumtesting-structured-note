// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IRuleEngine} from "debt-standard/interfaces/engine/IRuleEngine.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {CMTATBaseCommon} from "debt-standard/modules/0_CMTATBaseCommon.sol";
import {CMTATBaseRuleEngine} from "debt-standard/modules/3_CMTATBaseRuleEngine.sol";
import {CMTATBaseAccessControl} from "debt-standard/modules/2_CMTATBaseAccessControl.sol";
import {ValidationModule} from "debt-standard/modules/wrapper/controllers/ValidationModule.sol";
import {ValidationModuleRuleEngine} from
    "debt-standard/modules/wrapper/extensions/ValidationModule/ValidationModuleRuleEngine.sol";
import {ERC20EnforcementModuleInternal} from "debt-standard/modules/internal/ERC20EnforcementModuleInternal.sol";
import {ERC20EnforcementModule} from "debt-standard/modules/wrapper/extensions/ERC20EnforcementModule.sol";
import {ERC20EnforcementERC7551Module} from "debt-standard/modules/wrapper/options/ERC20EnforcementERC7551Module.sol";
import {AccessControlModule} from "debt-standard/modules/wrapper/security/AccessControlModule.sol";
import {IEligibilityGate} from "../interfaces/IEligibilityGate.sol";

/**
 * @title AdaptedToken
 * @notice The lean composition of the debt standard (spike 1) with the six ERC-7943
 *         adaptations of spike 2, shared by the note and the tokenized deposit so that the
 *         two cannot diverge on compliance semantics.
 *
 * The lean composition omits the standard's cross-chain and gasless-forwarder modules, which
 * neither instrument needs and which do not fit under EIP-170 with the rest. Upgrades are
 * native UUPS under their own role, which is what the Tier 2 ceremony holds.
 *
 * Adaptations, each closing a gap found in spike 2:
 * - **A1.** `canSend` and `canReceive` consult the gate, not only the freeze status.
 * - **A2.** Every gate query is a bounded static call that answers false on any failure, so no
 *   view can revert.
 * - **A3.** Forced transfer never delivers to an account that cannot receive.
 * - **A4.** The default admin holds only the roles it was granted. As shipped it passes every
 *   role check, which would collapse the two tiers into whoever holds it.
 * - **A5.** Forced transfer has its own role.
 * - **A6.** Mints and burns test only their real end.
 *
 * With no gate set, the views and transfers are unrestricted, as the standard defines. Every
 * deployment sets the gate in `initialize`.
 *
 * The ERC-20 surface is resolved here onto the standard's implementation. The note resolves it
 * once more, because its snapshot and holder-list modules bring their own ERC-20 base.
 */
abstract contract AdaptedToken is
    ReentrancyGuardTransient,
    CMTATBaseRuleEngine,
    ERC20EnforcementERC7551Module,
    UUPSUpgradeable
{
    bytes32 public constant PROXY_UPGRADE_ROLE = keccak256("PROXY_UPGRADE_ROLE");
    bytes32 public constant FORCED_TRANSFER_ROLE = keccak256("FORCED_TRANSFER_ROLE");

    /// @dev G2: a gate view is one or two storage reads; this is two orders of magnitude above.
    uint256 private constant GATE_GAS = 100_000;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // --- ERC-7943 adaptations ---

    /// @dev A2. Bounded gas, a 32-byte return, and exactly 1; anything else is false.
    function _gateView(bytes memory data) internal view returns (bool ok) {
        address gate = address(ruleEngine());
        if (gate == address(0)) return true;
        assembly ("memory-safe") {
            let success := staticcall(GATE_GAS, gate, add(data, 0x20), mload(data), 0x00, 0x20)
            ok := and(and(success, eq(returndatasize(), 0x20)), eq(mload(0x00), 1))
        }
    }

    /// @dev A1.
    function _canSend(address a) internal view virtual override(ValidationModule) returns (bool) {
        return ValidationModule._canSend(a) && _gateView(abi.encodeCall(IEligibilityGate.canSend, (a)));
    }

    /// @dev A1.
    function _canReceive(address a) internal view virtual override(ValidationModule) returns (bool) {
        return ValidationModule._canReceive(a) && _gateView(abi.encodeCall(IEligibilityGate.canReceive, (a)));
    }

    function _canTransferWithRuleEngine(address from, address to, uint256 v)
        internal
        view
        virtual
        override(ValidationModuleRuleEngine)
        returns (bool)
    {
        return _endsEligible(from, to)
            && _gateView(abi.encodeWithSignature("canTransfer(address,address,uint256)", from, to, v));
    }

    function _canTransferFromWithRuleEngine(address sp, address from, address to, uint256 v)
        internal
        view
        virtual
        override(ValidationModuleRuleEngine)
        returns (bool)
    {
        return _endsEligible(from, to)
            && _gateView(abi.encodeWithSignature("canTransferFrom(address,address,address,uint256)", sp, from, to, v));
    }

    /// @dev A6. A mint has no sender and a burn no recipient.
    function _endsEligible(address from, address to) private view returns (bool) {
        return (from == address(0) || _canSend(from)) && (to == address(0) || _canReceive(to));
    }

    /// @dev A3. Burning by forced transfer (recipient zero) is unaffected.
    function _forcedTransfer(address from, address to, uint256 v)
        internal
        virtual
        override(ERC20EnforcementModuleInternal)
    {
        if (to != address(0) && !_canReceive(to)) revert ERC7943CannotReceive(to);
        super._forcedTransfer(from, to, v);
    }

    /// @dev A4. Any self-grant by the admin is a visible `RoleGranted`, never implicit.
    function hasRole(bytes32 role, address account) public view virtual override(AccessControlModule) returns (bool) {
        return AccessControlUpgradeable.hasRole(role, account);
    }

    /// @dev A5.
    function _authorizeForcedTransfer()
        internal
        virtual
        override(CMTATBaseAccessControl, ERC20EnforcementModule)
        onlyRole(FORCED_TRANSFER_ROLE)
    {}

    // --- composition ---

    function _authorizeUpgrade(address) internal virtual override(UUPSUpgradeable) onlyRole(PROXY_UPGRADE_ROLE) {}

    /// @dev The rule-engine callback is guarded against reentry from the gate.
    function _callRuleEngineTransferred(IRuleEngine e, address spender, address from, address to, uint256 value)
        internal
        virtual
        override
        nonReentrant
    {
        super._callRuleEngineTransferred(e, spender, from, to, value);
    }

    function _authorizeERC20Enforcer() internal virtual override(CMTATBaseAccessControl, ERC20EnforcementModule) {
        CMTATBaseAccessControl._authorizeERC20Enforcer();
    }

    function getFrozenTokens(address a)
        public
        view
        virtual
        override(ERC20EnforcementModule, ERC20EnforcementERC7551Module)
        returns (uint256)
    {
        return ERC20EnforcementERC7551Module.getFrozenTokens(a);
    }

    function approve(address s, uint256 v) public virtual override(ERC20Upgradeable, CMTATBaseRuleEngine) returns (bool) {
        return CMTATBaseRuleEngine.approve(s, v);
    }

    function transfer(address to, uint256 v) public virtual override(ERC20Upgradeable, CMTATBaseCommon) returns (bool) {
        return CMTATBaseCommon.transfer(to, v);
    }

    function transferFrom(address f, address to, uint256 v)
        public
        virtual
        override(ERC20Upgradeable, CMTATBaseCommon)
        returns (bool)
    {
        return CMTATBaseCommon.transferFrom(f, to, v);
    }

    function decimals() public view virtual override(ERC20Upgradeable, CMTATBaseCommon) returns (uint8) {
        return CMTATBaseCommon.decimals();
    }

    function name() public view virtual override(ERC20Upgradeable, CMTATBaseCommon) returns (string memory) {
        return CMTATBaseCommon.name();
    }

    function symbol() public view virtual override(ERC20Upgradeable, CMTATBaseCommon) returns (string memory) {
        return CMTATBaseCommon.symbol();
    }
}
