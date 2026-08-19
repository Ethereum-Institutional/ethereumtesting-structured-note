// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {BaseAllowlistChecker} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/BaseAllowListChecker.sol";
import {PermissionFlags, PermissionFlag} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";
import {IERC7943Token} from "./interfaces/IERC3643.sol";

/**
 * @title ERC7943AllowlistChecker
 * @notice Bridges an ERC-7943 (uRWA) token into Uniswap v4 permissioned pools.
 *
 * The counterpart to {ERC3643AllowlistChecker}. Both answer the same question for the same
 * hook -- "what may this account do with this asset?" -- but read different sources of truth:
 *
 *   - ERC-3643 keeps identity in a separate registry with claims signed by trusted issuers,
 *     so the checker can distinguish *why* an account qualifies (KYC vs professional-investor
 *     attestation) and gate liquidity provision on the specific claim.
 *   - ERC-7943 keeps a flat allow/disallow list on the token itself. There is no claim to
 *     inspect, so anything finer than "allowed" has to be maintained by the venue. That is
 *     what {setLiquidityApproved} is for.
 *
 * Same hook, same adapter, same pool mechanics either way. Only this contract changes, which
 * is the point: the compliance seam is the swappable part.
 */
contract ERC7943AllowlistChecker is BaseAllowlistChecker, Ownable2Step {
    mapping(address token => bool) private _registered;
    /// @dev Venue-maintained liquidity permission, since ERC-7943 carries no claim to read.
    mapping(address token => mapping(address account => bool)) private _liquidityApproved;
    /// @dev When false, any allowed holder may provide liquidity.
    mapping(address token => bool) private _restrictLiquidity;

    event AssetRegistered(address indexed token);
    event AssetUnregistered(address indexed token);
    event LiquidityRestrictionUpdated(address indexed token, bool restricted);
    event LiquidityApprovalUpdated(address indexed token, address indexed account, bool approved);

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

    /// @inheritdoc BaseAllowlistChecker
    function checkAllowlist(address account, address tokenAddress)
        public
        view
        override
        returns (PermissionFlag)
    {
        if (!_registered[tokenAddress]) return PermissionFlags.NONE;
        if (_isPaused(tokenAddress)) return PermissionFlags.NONE;
        if (!_isAllowed(tokenAddress, account)) return PermissionFlags.NONE;

        // A wholly frozen balance cannot trade. A partial freeze still leaves room, and the
        // token itself rejects any transfer that would dip into the frozen portion.
        if (_isWhollyFrozen(tokenAddress, account)) return PermissionFlags.NONE;

        PermissionFlag granted = PermissionFlags.SWAP_ALLOWED;
        if (!_restrictLiquidity[tokenAddress] || _liquidityApproved[tokenAddress][account]) {
            granted = granted | PermissionFlags.LIQUIDITY_ALLOWED;
        }
        return granted;
    }

    /// @notice Per-gate breakdown for the dashboard, mirroring {ERC3643AllowlistChecker-explain}.
    function explain(address account, address tokenAddress)
        external
        view
        returns (
            bool registeredAsset,
            bool assetPaused,
            bool userAllowed,
            bool whollyFrozen,
            bool liquidityApproved,
            PermissionFlag flags
        )
    {
        registeredAsset = _registered[tokenAddress];
        if (!registeredAsset) return (false, false, false, false, false, PermissionFlags.NONE);
        assetPaused = _isPaused(tokenAddress);
        userAllowed = _isAllowed(tokenAddress, account);
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

    // --- fault-tolerant reads: an unconfigured token denies rather than reverting in beforeSwap ---

    function _isPaused(address token) private view returns (bool) {
        try IERC7943Token(token).paused() returns (bool p) {
            return p;
        } catch {
            return false;
        }
    }

    function _isAllowed(address token, address account) private view returns (bool) {
        try IERC7943Token(token).isUserAllowed(account) returns (bool a) {
            return a;
        } catch {
            return false;
        }
    }

    function _isWhollyFrozen(address token, address account) private view returns (bool) {
        try IERC7943Token(token).available(account) returns (uint256 avail) {
            if (avail > 0) return false;
            // available()==0 only blocks trading if the holder actually has a frozen balance.
            try IERC7943Token(token).balanceOf(account) returns (uint256 bal) {
                return bal > 0;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }
}
