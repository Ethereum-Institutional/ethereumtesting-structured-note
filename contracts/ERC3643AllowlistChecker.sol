// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {BaseAllowlistChecker} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/BaseAllowListChecker.sol";
import {PermissionFlags, PermissionFlag} from
    "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";
import {IERC3643IdentityRegistry, IERC3643Token, IOnchainIdentity} from "./interfaces/IERC3643.sol";

/**
 * @title ERC3643AllowlistChecker
 * @notice Translates ERC-3643 (T-REX) on-chain identity into the `PermissionFlag`
 *         vocabulary that Uniswap v4 Permissioned Pools enforce.
 *
 * This is the seam between the two standards. Uniswap's `PermissionsAdapter` asks a
 * single question -- "what may this account do with this asset?" -- and this contract
 * answers it by reading the issuer's identity registry rather than a venue-held list.
 * The issuer stays the source of truth: revoke a claim or freeze a wallet in T-REX and
 * that account stops trading, with no venue action required.
 *
 * Three layers are applied, cheapest first:
 *   1. Asset gate    -- is the token registered here, and not paused?
 *   2. Identity gate -- `isVerified` (registered + required claims from trusted issuers)
 *                       and not frozen.
 *   3. Capability     -- swapping is granted to any verified holder; providing liquidity
 *                       can additionally require a specific claim topic (e.g. a
 *                       professional-investor attestation), and an optional venue-level
 *                       country allowlist can be layered on top of the issuer's own rules.
 *
 * All external reads are wrapped in `try/catch`: an unconfigured or reverting issuer
 * stack yields `NONE` (deny) instead of bubbling an opaque revert up through `beforeSwap`.
 */
contract ERC3643AllowlistChecker is BaseAllowlistChecker, Ownable2Step {
    struct AssetPolicy {
        bool enabled;
        address identityRegistry;
        /// @dev Claim topic additionally required to provide liquidity. 0 = swap-equivalent.
        uint256 liquidityClaimTopic;
        /// @dev When true, `investorCountry` must also appear in this venue's allowlist.
        bool enforceCountry;
    }

    mapping(address token => AssetPolicy) private _policies;
    mapping(address token => mapping(uint16 country => bool)) private _countryAllowed;

    event AssetRegistered(address indexed token, address indexed identityRegistry, uint256 liquidityClaimTopic);
    event AssetUnregistered(address indexed token);
    event CountryEnforcementUpdated(address indexed token, bool enforced);
    event CountryAllowanceUpdated(address indexed token, uint16 indexed country, bool allowed);
    event LiquidityClaimTopicUpdated(address indexed token, uint256 claimTopic);

    error AssetNotRegistered(address token);
    error IdentityRegistryUnavailable(address token);

    constructor(address initialOwner) Ownable(initialOwner) {}

    // --------------------------------------------------------------------- //
    //                              Administration                           //
    // --------------------------------------------------------------------- //

    /**
     * @notice Registers an ERC-3643 token, caching the identity registry it points at.
     * @param token The ERC-3643 token that a `PermissionsAdapter` will wrap.
     * @param liquidityClaimTopic Claim topic an account must additionally hold to provide
     *        liquidity. Pass 0 to let any verified holder LP.
     */
    function registerAsset(address token, uint256 liquidityClaimTopic) external onlyOwner {
        address registry = _readIdentityRegistry(token);
        if (registry == address(0)) revert IdentityRegistryUnavailable(token);

        _policies[token] = AssetPolicy({
            enabled: true,
            identityRegistry: registry,
            liquidityClaimTopic: liquidityClaimTopic,
            enforceCountry: false
        });
        emit AssetRegistered(token, registry, liquidityClaimTopic);
    }

    function unregisterAsset(address token) external onlyOwner {
        delete _policies[token];
        emit AssetUnregistered(token);
    }

    function setLiquidityClaimTopic(address token, uint256 claimTopic) external onlyOwner {
        if (!_policies[token].enabled) revert AssetNotRegistered(token);
        _policies[token].liquidityClaimTopic = claimTopic;
        emit LiquidityClaimTopicUpdated(token, claimTopic);
    }

    /// @notice Turns the venue-level country overlay on or off for an asset.
    function setCountryEnforcement(address token, bool enforced) external onlyOwner {
        if (!_policies[token].enabled) revert AssetNotRegistered(token);
        _policies[token].enforceCountry = enforced;
        emit CountryEnforcementUpdated(token, enforced);
    }

    /// @notice Allows or blocks an ISO-3166 numeric country code at the venue level.
    function setCountryAllowed(address token, uint16 country, bool allowed) external onlyOwner {
        _countryAllowed[token][country] = allowed;
        emit CountryAllowanceUpdated(token, country, allowed);
    }

    /// @notice Batch form of {setCountryAllowed}.
    function setCountriesAllowed(address token, uint16[] calldata countries, bool allowed) external onlyOwner {
        for (uint256 i = 0; i < countries.length; ++i) {
            _countryAllowed[token][countries[i]] = allowed;
            emit CountryAllowanceUpdated(token, countries[i], allowed);
        }
    }

    // --------------------------------------------------------------------- //
    //                          Allowlist evaluation                         //
    // --------------------------------------------------------------------- //

    /// @inheritdoc BaseAllowlistChecker
    function checkAllowlist(address account, address tokenAddress)
        public
        view
        override
        returns (PermissionFlag)
    {
        AssetPolicy memory policy = _policies[tokenAddress];
        if (!policy.enabled) return PermissionFlags.NONE;

        // 1. Asset-level: an issuer-paused token trades nowhere.
        if (_isPaused(tokenAddress)) return PermissionFlags.NONE;

        // 2. Identity-level: verified claims, wallet not frozen.
        if (_isFrozen(tokenAddress, account)) return PermissionFlags.NONE;
        if (!_isVerified(policy.identityRegistry, account)) return PermissionFlags.NONE;

        // 3. Venue overlay: optional jurisdiction gate on top of issuer compliance.
        if (policy.enforceCountry) {
            (bool ok, uint16 country) = _investorCountry(policy.identityRegistry, account);
            if (!ok || !_countryAllowed[tokenAddress][country]) return PermissionFlags.NONE;
        }

        PermissionFlag granted = PermissionFlags.SWAP_ALLOWED;

        // Liquidity provision may demand a further attestation.
        if (
            policy.liquidityClaimTopic == 0
                || _holdsClaim(policy.identityRegistry, account, policy.liquidityClaimTopic)
        ) {
            granted = granted | PermissionFlags.LIQUIDITY_ALLOWED;
        }

        return granted;
    }

    // --------------------------------------------------------------------- //
    //                                  Views                                //
    // --------------------------------------------------------------------- //

    function policyOf(address token)
        external
        view
        returns (bool enabled, address identityRegistry, uint256 liquidityClaimTopic, bool enforceCountry)
    {
        AssetPolicy memory p = _policies[token];
        return (p.enabled, p.identityRegistry, p.liquidityClaimTopic, p.enforceCountry);
    }

    function isCountryAllowed(address token, uint16 country) external view returns (bool) {
        return _countryAllowed[token][country];
    }

    /**
     * @notice Human-readable breakdown of why an account is or is not permitted.
     * @dev Powers the custody dashboard: the UI shows which gate failed rather than a
     *      bare boolean. Not used by the hook path.
     */
    function explain(address account, address tokenAddress)
        external
        view
        returns (
            bool registeredAsset,
            bool assetPaused,
            bool walletFrozen,
            bool identityVerified,
            bool countryPermitted,
            bool holdsLiquidityClaim,
            PermissionFlag flags
        )
    {
        AssetPolicy memory p = _policies[tokenAddress];
        registeredAsset = p.enabled;
        if (!p.enabled) return (false, false, false, false, false, false, PermissionFlags.NONE);

        assetPaused = _isPaused(tokenAddress);
        walletFrozen = _isFrozen(tokenAddress, account);
        identityVerified = _isVerified(p.identityRegistry, account);

        if (p.enforceCountry) {
            (bool ok, uint16 country) = _investorCountry(p.identityRegistry, account);
            countryPermitted = ok && _countryAllowed[tokenAddress][country];
        } else {
            countryPermitted = true;
        }

        holdsLiquidityClaim =
            p.liquidityClaimTopic == 0 || _holdsClaim(p.identityRegistry, account, p.liquidityClaimTopic);

        flags = checkAllowlist(account, tokenAddress);
    }

    // --------------------------------------------------------------------- //
    //                     Fault-tolerant issuer-stack reads                 //
    // --------------------------------------------------------------------- //

    function _readIdentityRegistry(address token) private view returns (address) {
        try IERC3643Token(token).identityRegistry() returns (address registry) {
            return registry;
        } catch {
            return address(0);
        }
    }

    function _isPaused(address token) private view returns (bool) {
        try IERC3643Token(token).paused() returns (bool paused) {
            return paused;
        } catch {
            return false;
        }
    }

    function _isFrozen(address token, address account) private view returns (bool) {
        try IERC3643Token(token).isFrozen(account) returns (bool frozen) {
            return frozen;
        } catch {
            return false;
        }
    }

    function _isVerified(address registry, address account) private view returns (bool) {
        try IERC3643IdentityRegistry(registry).isVerified(account) returns (bool verified) {
            return verified;
        } catch {
            return false;
        }
    }

    function _investorCountry(address registry, address account) private view returns (bool, uint16) {
        try IERC3643IdentityRegistry(registry).investorCountry(account) returns (uint16 country) {
            return (true, country);
        } catch {
            return (false, 0);
        }
    }

    function _holdsClaim(address registry, address account, uint256 topic) private view returns (bool) {
        address onchainId;
        try IERC3643IdentityRegistry(registry).identity(account) returns (address id) {
            onchainId = id;
        } catch {
            return false;
        }
        if (onchainId == address(0)) return false;

        try IOnchainIdentity(onchainId).getClaimIdsByTopic(topic) returns (bytes32[] memory ids) {
            return ids.length > 0;
        } catch {
            return false;
        }
    }
}
