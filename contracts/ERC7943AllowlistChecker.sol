// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {BaseAllowlistChecker} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/BaseAllowListChecker.sol";
import {PermissionFlags, PermissionFlag} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";
import {IERC7943FungibleViews, IPausable} from "./interfaces/IERC7943.sol";

interface ICredentialGate {
    function isAllowed(address account) external view returns (bool);
}

/**
 * @title ERC7943AllowlistChecker
 * @notice Answers the venue's one question, "what may this account do with this asset?", from
 *         the asset's own ERC-7943 views.
 *
 * Eligibility is the token's, not the venue's: an account may swap only if the token says it
 * can both send and receive, the token is not paused, and the account's balance is not wholly
 * frozen. Revoking eligibility on the token therefore stops trading with no venue action.
 *
 * The token carries no finer distinction, so permission to provide liquidity, where the venue
 * restricts it, is the venue's own list ({setLiquidityApproved}).
 *
 * A token may also carry a credential gate ({setCredentialGate}): the venue's own perimeter,
 * which the account must pass in addition to the token's eligibility (ADR 0031). It is read
 * through the same checked static call, so a gate that reverts or has no code denies.
 *
 * One checker serves every asset, since the asset is a parameter of every query.
 *
 * Every read of the token fails closed. An account view that reverts, returns malformed data
 * or reaches an address with no code denies. The one exception is `paused()`, which is not
 * part of ERC-7943: a token without it is treated as having no pause.
 */
contract ERC7943AllowlistChecker is BaseAllowlistChecker, Ownable2Step {
    mapping(address token => bool) private _registered;
    /// @dev Venue-maintained liquidity permission, since ERC-7943 carries no attribute to read.
    mapping(address token => mapping(address account => bool)) private _liquidityApproved;
    /// @dev When false, any eligible holder may provide liquidity.
    mapping(address token => bool) private _restrictLiquidity;
    /// @dev Where set, the account must also hold a live grant in this gate.
    mapping(address token => address) private _credentialGate;

    event AssetRegistered(address indexed token);
    event AssetUnregistered(address indexed token);
    event LiquidityRestrictionUpdated(address indexed token, bool restricted);
    event LiquidityApprovalUpdated(address indexed token, address indexed account, bool approved);
    event CredentialGateUpdated(address indexed token, address indexed gate);

    error AssetNotRegistered(address token);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerAsset(address token) external onlyOwner {
        _registered[token] = true;
        emit AssetRegistered(token);
    }

    function unregisterAsset(address token) external onlyOwner {
        delete _registered[token];
        emit AssetUnregistered(token);
    }

    /// @notice When enabled, providing liquidity additionally requires venue approval.
    function setLiquidityRestricted(address token, bool restricted) external onlyOwner {
        if (!_registered[token]) revert AssetNotRegistered(token);
        _restrictLiquidity[token] = restricted;
        emit LiquidityRestrictionUpdated(token, restricted);
    }

    function setLiquidityApproved(address token, address account, bool approved) external onlyOwner {
        _liquidityApproved[token][account] = approved;
        emit LiquidityApprovalUpdated(token, account, approved);
    }

    /// @notice Sets the credential gate an account must also pass for this token, or clears it.
    function setCredentialGate(address token, address gate) external onlyOwner {
        if (!_registered[token]) revert AssetNotRegistered(token);
        _credentialGate[token] = gate;
        emit CredentialGateUpdated(token, gate);
    }

    /// @inheritdoc BaseAllowlistChecker
    function checkAllowlist(address account, address tokenAddress)
        public
        view
        override
        returns (PermissionFlag)
    {
        if (!_registered[tokenAddress]) return PermissionFlags.NONE;
        if (_isPaused(tokenAddress)) return PermissionFlags.NONE;
        if (!_isEligible(tokenAddress, account)) return PermissionFlags.NONE;
        if (!_isCredentialed(tokenAddress, account)) return PermissionFlags.NONE;

        // A wholly frozen balance cannot trade. A partial freeze still leaves room, and the
        // token itself rejects any transfer that would reach into the frozen portion.
        if (_isWhollyFrozen(tokenAddress, account)) return PermissionFlags.NONE;

        PermissionFlag granted = PermissionFlags.SWAP_ALLOWED;
        if (!_restrictLiquidity[tokenAddress] || _liquidityApproved[tokenAddress][account]) {
            granted = granted | PermissionFlags.LIQUIDITY_ALLOWED;
        }
        return granted;
    }

    /// @notice Each input to {checkAllowlist}, so that a denial can be explained.
    function explain(address account, address tokenAddress)
        external
        view
        returns (
            bool registeredAsset,
            bool assetPaused,
            bool eligible,
            bool credentialed,
            bool whollyFrozen,
            bool liquidityApproved,
            PermissionFlag flags
        )
    {
        registeredAsset = _registered[tokenAddress];
        if (!registeredAsset) return (false, false, false, false, false, false, PermissionFlags.NONE);
        assetPaused = _isPaused(tokenAddress);
        eligible = _isEligible(tokenAddress, account);
        credentialed = _isCredentialed(tokenAddress, account);
        whollyFrozen = _isWhollyFrozen(tokenAddress, account);
        liquidityApproved =
            !_restrictLiquidity[tokenAddress] || _liquidityApproved[tokenAddress][account];
        flags = checkAllowlist(account, tokenAddress);
    }

    function isRegistered(address token) external view returns (bool) {
        return _registered[token];
    }

    function isLiquidityRestricted(address token) external view returns (bool) {
        return _restrictLiquidity[token];
    }

    function credentialGate(address token) external view returns (address) {
        return _credentialGate[token];
    }

    // --- token reads ---

    function _isPaused(address token) private view returns (bool) {
        (bool ok, uint256 value) = _read(token, abi.encodeCall(IPausable.paused, ()));
        return ok && value == 1;
    }

    /// @dev A swap both sends and receives the asset, so both must hold.
    function _isEligible(address token, address account) private view returns (bool) {
        (bool sendOk, uint256 canSend) = _read(token, abi.encodeCall(IERC7943FungibleViews.canSend, (account)));
        if (!sendOk || canSend != 1) return false;
        (bool receiveOk, uint256 canReceive) =
            _read(token, abi.encodeCall(IERC7943FungibleViews.canReceive, (account)));
        return receiveOk && canReceive == 1;
    }

    /// @dev No gate configured passes; an unreadable gate denies.
    function _isCredentialed(address token, address account) private view returns (bool) {
        address gate = _credentialGate[token];
        if (gate == address(0)) return true;
        (bool ok, uint256 allowed) = _read(gate, abi.encodeCall(ICredentialGate.isAllowed, (account)));
        return ok && allowed == 1;
    }

    /// @dev Unreadable counts as frozen, so that it denies.
    function _isWhollyFrozen(address token, address account) private view returns (bool) {
        (bool balanceOk, uint256 balance) =
            _read(token, abi.encodeCall(IERC7943FungibleViews.balanceOf, (account)));
        (bool frozenOk, uint256 frozen) =
            _read(token, abi.encodeCall(IERC7943FungibleViews.getFrozenTokens, (account)));
        if (!balanceOk || !frozenOk) return true;
        return balance > 0 && frozen >= balance;
    }

    /**
     * @dev A static call that reports failure rather than reverting. A `try` block does not
     *      catch a call to an address with no code, or return data that fails to decode, so
     *      the call is made directly and the return data checked for one word.
     */
    function _read(address target, bytes memory data) private view returns (bool ok, uint256 value) {
        (bool success, bytes memory ret) = target.staticcall(data);
        if (!success || ret.length != 32) return (false, 0);
        return (true, abi.decode(ret, (uint256)));
    }
}
