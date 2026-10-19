// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @dev The pool's ERC-3643 identity registry, as far as the gate reads it. T-REX's registry is in
///      the other compilation unit.
interface IPoolIdentityRegistry {
    function isVerified(address account) external view returns (bool);
    function investorCountry(address account) external view returns (uint16);
}

/**
 * @title IdentityPoolGate
 * @notice The conversion pool's eligibility perimeter on ONCHAINID identities (ADR 0090): a wallet
 *         may use the pool when the pool's ERC-3643 identity registry verifies it, its country is
 *         one the pool serves, and supervision has not withdrawn it.
 *
 * - **Identities, not a second register.** The pool's registry reads the deployment's one identity
 *   storage, so a wallet the bank registered for the deposit is known to the pool too. It requires
 *   one claim, `claim.pool-access`, from an issuer it trusts: the bank's, which vouches that its
 *   client is a professional or institutional investor, screened. The issuer's
 *   own rules decide validity, including lapse and revocation, so a claim revoked or lapsed stops
 *   the wallet at once, with no transaction here.
 * - **Jurisdiction.** The country the identity storage records for the wallet must be one of the
 *   pool's, fixed at construction: the European Economic Area, Switzerland and the United Kingdom.
 * - **Supervision.** The supervisor, the governance controller, withdraws a wallet with a written
 *   reason, whatever its claim says, and restores it the same way.
 * - **One question on the swap path.** {isAllowed} never reverts: a registry that cannot answer
 *   denies.
 *
 * Which issuers may vouch is the registry's, under the controller's Tier 2. Stores no attribute of
 * any investor.
 */
contract IdentityPoolGate is AccessControl {
    bytes32 public constant SUPERVISOR_ROLE = keccak256("SUPERVISOR_ROLE");

    /// @notice Why a wallet may or may not use the pool, in the order the gate asks.
    enum Standing {
        Allowed,
        Withdrawn,
        NotVerified,
        JurisdictionNotServed
    }

    IPoolIdentityRegistry public immutable REGISTRY;

    mapping(uint16 country => bool) public serves;
    uint16[] private _jurisdictions;
    mapping(address account => bool) public withdrawn;

    event AccessWithdrawn(address indexed account, string reason);
    event AccessRestored(address indexed account, string reason);

    error InvalidConfiguration(string reason);
    error NoReason();
    error AlreadyWithdrawn(address account);
    error NotWithdrawn(address account);

    /// @param jurisdictions_ ISO 3166-1 numeric codes, as the identity storage records countries.
    constructor(address admin, IPoolIdentityRegistry registry_, uint16[] memory jurisdictions_) {
        if (admin == address(0)) revert InvalidConfiguration("no admin");
        if (address(registry_).code.length == 0) revert InvalidConfiguration("no registry");
        if (jurisdictions_.length == 0) revert InvalidConfiguration("no jurisdiction");
        for (uint256 k = 0; k < jurisdictions_.length; ++k) {
            uint16 c = jurisdictions_[k];
            if (c == 0 || c > 999 || serves[c]) revert InvalidConfiguration("jurisdiction invalid or repeated");
            serves[c] = true;
        }
        _jurisdictions = jurisdictions_;
        REGISTRY = registry_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Whether `account` may use the pool now. Never reverts.
    function isAllowed(address account) external view returns (bool) {
        return standing(account) == Standing.Allowed;
    }

    /// @notice Why `account` may or may not use the pool now. Never reverts.
    function standing(address account) public view returns (Standing) {
        if (withdrawn[account]) return Standing.Withdrawn;
        try REGISTRY.isVerified(account) returns (bool verified) {
            if (!verified) return Standing.NotVerified;
        } catch {
            return Standing.NotVerified;
        }
        try REGISTRY.investorCountry(account) returns (uint16 country) {
            return serves[country] ? Standing.Allowed : Standing.JurisdictionNotServed;
        } catch {
            return Standing.JurisdictionNotServed;
        }
    }

    /// @notice Withdraws `account` from the pool at once, whatever its claim says.
    function withdraw(address account, string calldata reason) external onlyRole(SUPERVISOR_ROLE) {
        if (bytes(reason).length == 0) revert NoReason();
        if (withdrawn[account]) revert AlreadyWithdrawn(account);
        withdrawn[account] = true;
        emit AccessWithdrawn(account, reason);
    }

    /// @notice Lifts a withdrawal. The wallet uses the pool again only while its claim is valid.
    function restore(address account, string calldata reason) external onlyRole(SUPERVISOR_ROLE) {
        if (bytes(reason).length == 0) revert NoReason();
        if (!withdrawn[account]) revert NotWithdrawn(account);
        withdrawn[account] = false;
        emit AccessRestored(account, reason);
    }

    /// @notice The pool's identity registry, as the controller reaches its trusted issuers.
    function registry() external view returns (address) {
        return address(REGISTRY);
    }

    function jurisdictions() external view returns (uint16[] memory) {
        return _jurisdictions;
    }
}
