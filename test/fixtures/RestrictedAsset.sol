// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title RestrictedAsset
 * @notice Stand-in for a permissioned asset exposing the ERC-7943 fungible interface, so the
 *         venue can be exercised before the instruments exist. It is not an instrument and is
 *         not in audit scope.
 *
 * The smallest token that behaves as the venue must expect: an eligibility list held by the
 * Issuer, and pause, partial freeze and forced transfer held by the Agent. Every ordinary
 * transfer is checked against all of them, so the venue meets the same refusals it will meet
 * from a real instrument.
 */
contract RestrictedAsset is ERC20 {
    address public immutable ISSUER;
    address public immutable AGENT;

    bool public paused;
    mapping(address account => bool) private _eligible;
    mapping(address account => uint256) private _frozen;
    bool private _forcing;

    event EligibilityUpdated(address indexed account, bool eligible);
    event Paused(address account);
    event Unpaused(address account);
    /// @dev ERC-7943.
    event Frozen(address indexed account, uint256 amount);
    /// @dev ERC-7943.
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount);

    error NotIssuer(address caller);
    error NotAgent(address caller);
    error AssetPaused();
    /// @dev ERC-7943.
    error ERC7943CannotSend(address account);
    /// @dev ERC-7943.
    error ERC7943CannotReceive(address account);
    /// @dev ERC-7943.
    error ERC7943InsufficientUnfrozenBalance(address account, uint256 amount, uint256 unfrozen);

    constructor(string memory name_, string memory symbol_, address issuer, address agent)
        ERC20(name_, symbol_)
    {
        ISSUER = issuer;
        AGENT = agent;
    }

    modifier onlyIssuer() {
        if (msg.sender != ISSUER) revert NotIssuer(msg.sender);
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != AGENT) revert NotAgent(msg.sender);
        _;
    }

    // --- Issuer ---

    function setEligible(address account, bool eligible) external onlyIssuer {
        _eligible[account] = eligible;
        emit EligibilityUpdated(account, eligible);
    }

    function mint(address to, uint256 amount) external onlyIssuer {
        _mint(to, amount);
    }

    // --- Agent ---

    function pause() external onlyAgent {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyAgent {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @dev ERC-7943.
    function setFrozenTokens(address account, uint256 amount) external onlyAgent returns (bool) {
        _frozen[account] = amount;
        emit Frozen(account, amount);
        return true;
    }

    /// @dev ERC-7943. Unfreezes what it must first, and never delivers to an ineligible account.
    function forcedTransfer(address from, address to, uint256 amount) external onlyAgent returns (bool) {
        if (!_eligible[to]) revert ERC7943CannotReceive(to);
        uint256 unfrozen = _unfrozen(from);
        if (amount > unfrozen) {
            uint256 remaining = balanceOf(from) - amount;
            _frozen[from] = remaining;
            emit Frozen(from, remaining);
        }
        _forcing = true;
        _transfer(from, to, amount);
        _forcing = false;
        emit ForcedTransfer(from, to, amount);
        return true;
    }

    // --- ERC-7943 views ---

    function canSend(address account) public view returns (bool) {
        return _eligible[account];
    }

    function canReceive(address account) public view returns (bool) {
        return _eligible[account];
    }

    function getFrozenTokens(address account) external view returns (uint256) {
        return _frozen[account];
    }

    function canTransfer(address from, address to, uint256 amount) external view returns (bool) {
        return !paused && canSend(from) && canReceive(to) && amount <= _unfrozen(from);
    }

    // --- enforcement ---

    function _unfrozen(address account) private view returns (uint256) {
        uint256 balance = balanceOf(account);
        uint256 frozen = _frozen[account];
        return frozen >= balance ? 0 : balance - frozen;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (!_forcing) {
            if (paused) revert AssetPaused();
            if (from != address(0) && !_eligible[from]) revert ERC7943CannotSend(from);
            if (to != address(0) && !_eligible[to]) revert ERC7943CannotReceive(to);
            if (from != address(0)) {
                uint256 unfrozen = _unfrozen(from);
                if (amount > unfrozen) revert ERC7943InsufficientUnfrozenBalance(from, amount, unfrozen);
            }
        }
        super._update(from, to, amount);
    }
}
