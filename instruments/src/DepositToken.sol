// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IVerifies} from "./interfaces/INote.sol";

/// ERC-7943 (uRWA), fungible, as published (Final).
interface IERC7943Fungible is IERC165 {
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount);
    event Frozen(address indexed account, uint256 amount);

    error ERC7943CannotSend(address account);
    error ERC7943CannotReceive(address account);
    error ERC7943InsufficientUnfrozenBalance(address account, uint256 amount, uint256 unfrozen);

    function forcedTransfer(address from, address to, uint256 amount) external returns (bool result);
    function setFrozenTokens(address account, uint256 amount) external returns (bool result);
    function canSend(address account) external view returns (bool allowed);
    function canReceive(address account) external view returns (bool allowed);
    function getFrozenTokens(address account) external view returns (uint256 amount);
    function canTransfer(address from, address to, uint256 amount) external view returns (bool allowed);
}

/**
 * @title DepositToken
 * @notice The cash leg: a mock of a bank's tokenized deposit on a public network, shaped like the
 *         one bank deposit token whose source is public (ADR 0086). A liability of the bank,
 *         created on credit to a client's account and extinguished on debit.
 *
 * - **Who may hold it.** An account the bank's own ERC-3643 identity registry for the deposit
 *   verifies, because the bank's claim issuer has vouched for it, or one on the explicit
 *   allowlist, which is for contracts: the Paying Agent and the settlement contract. The registry
 *   shares its identity storage with the note's, so a client's identity is created once, while
 *   each asset keeps its own issuers: the bank alone decides who may hold its cash.
 * - **Every transfer checks sender, receiver and spender.** A contract moving the deposit under
 *   an allowance must itself be eligible, as with any allowlisted deposit token.
 * - **Roles.** Mint and burn for the deposit gateway alone; pause, allowlist, freeze and forced
 *   transfer each a role of its own; the admin assigns them and points the token at its registry.
 * - **Freezing and forced transfer** follow ERC-7943. A forced transfer never delivers to an
 *   account that cannot receive, and takes from the frozen part only what the free part lacks.
 * - **Pausing** stops transfers, credits and debits. A forced transfer still proceeds.
 *
 * Two decimals. Not upgradeable, not capped, and adding to the allowlist takes effect at once:
 * a mock needs neither the cap nor the timelock a production deposit token carries.
 */
contract DepositToken is ERC20, AccessControl, Pausable, IERC7943Fungible {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant ALLOWLIST_ROLE = keccak256("ALLOWLIST_ROLE");
    bytes32 public constant FREEZER_ROLE = keccak256("FREEZER_ROLE");
    bytes32 public constant FORCED_TRANSFER_ROLE = keccak256("FORCED_TRANSFER_ROLE");

    /// @notice The bank's identity registry for the deposit.
    IVerifies public identityRegistry;
    mapping(address account => bool) public allowlisted;
    mapping(address account => uint256) private _frozen;

    bool private _forcing;

    event IdentityRegistrySet(address indexed registry);
    event Allowlisted(address indexed account, bool allowed);

    error NotEligible(address account);

    constructor(string memory name_, string memory symbol_, address admin, IVerifies registry)
        ERC20(name_, symbol_)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _setIdentityRegistry(registry);
    }

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    // --- the bank ---

    function mint(address account, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(account, amount);
    }

    function burn(address account, uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(account, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function setAllowlisted(address account, bool allowed) external onlyRole(ALLOWLIST_ROLE) {
        allowlisted[account] = allowed;
        emit Allowlisted(account, allowed);
    }

    /// @notice Allowlists several accounts, or removes them, in one call: a note's lifecycle
    ///         contracts at issuance (ADR 0091).
    function setAllowlistedMany(address[] calldata accounts, bool allowed) external onlyRole(ALLOWLIST_ROLE) {
        for (uint256 k = 0; k < accounts.length; ++k) {
            allowlisted[accounts[k]] = allowed;
            emit Allowlisted(accounts[k], allowed);
        }
    }

    function setIdentityRegistry(IVerifies registry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setIdentityRegistry(registry);
    }

    /// @inheritdoc IERC7943Fungible
    function setFrozenTokens(address account, uint256 amount) external onlyRole(FREEZER_ROLE) returns (bool) {
        _frozen[account] = amount;
        emit Frozen(account, amount);
        return true;
    }

    /// @inheritdoc IERC7943Fungible
    function forcedTransfer(address from, address to, uint256 amount)
        external
        onlyRole(FORCED_TRANSFER_ROLE)
        returns (bool)
    {
        if (to != address(0) && !canReceive(to)) revert ERC7943CannotReceive(to);
        uint256 free = _unfrozen(from);
        if (amount > free) {
            _frozen[from] -= amount - free;
            emit Frozen(from, _frozen[from]);
        }
        _forcing = true;
        _update(from, to, amount);
        _forcing = false;
        emit ForcedTransfer(from, to, amount);
        return true;
    }

    // --- views ---

    /// @inheritdoc IERC7943Fungible
    function canSend(address account) public view returns (bool) {
        return _eligible(account);
    }

    /// @inheritdoc IERC7943Fungible
    function canReceive(address account) public view returns (bool) {
        return _eligible(account);
    }

    /// @inheritdoc IERC7943Fungible
    function canTransfer(address from, address to, uint256 amount) external view returns (bool) {
        return !paused() && canSend(from) && canReceive(to) && amount <= _unfrozen(from);
    }

    /// @inheritdoc IERC7943Fungible
    function getFrozenTokens(address account) external view returns (uint256) {
        return _frozen[account];
    }

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl, IERC165) returns (bool) {
        return interfaceId == type(IERC7943Fungible).interfaceId || super.supportsInterface(interfaceId);
    }

    // --- the spender ---

    function approve(address spender, uint256 value) public override returns (bool) {
        if (!_eligible(_msgSender())) revert ERC7943CannotSend(_msgSender());
        if (!_eligible(spender)) revert NotEligible(spender);
        return super.approve(spender, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (!_eligible(_msgSender())) revert NotEligible(_msgSender());
        return super.transferFrom(from, to, value);
    }

    // --- internal ---

    /// @dev Every movement of balance passes here. A forced transfer has checked its own terms.
    function _update(address from, address to, uint256 amount) internal override {
        if (!_forcing) {
            _requireNotPaused();
            if (from != address(0)) {
                if (to != address(0) && !canSend(from)) revert ERC7943CannotSend(from);
                uint256 free = _unfrozen(from);
                if (amount > free) revert ERC7943InsufficientUnfrozenBalance(from, amount, free);
            }
            if (to != address(0) && !canReceive(to)) revert ERC7943CannotReceive(to);
        }
        super._update(from, to, amount);
    }

    function _unfrozen(address account) private view returns (uint256) {
        uint256 balance = balanceOf(account);
        uint256 frozen = _frozen[account];
        return balance > frozen ? balance - frozen : 0;
    }

    /// @dev False on any failure of the registry, so no view can revert.
    function _eligible(address account) private view returns (bool) {
        if (allowlisted[account]) return true;
        if (address(identityRegistry) == address(0)) return false;
        try identityRegistry.isVerified(account) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    function _setIdentityRegistry(IVerifies registry) private {
        identityRegistry = registry;
        emit IdentityRegistrySet(address(registry));
    }
}
