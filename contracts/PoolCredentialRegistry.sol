// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ICredentialIssuers, ICredentialRevocations} from "./interfaces/ICredentialProtocol.sol";

/**
 * @title PoolCredentialRegistry
 * @notice The conversion pool's own eligibility perimeter: which wallets hold a live grant written
 *         from a verifiable credential of the configured issuer, whose attributes met the policy
 *         this contract states (ADRs 0030 to 0037).
 *
 * - **Verified off-chain, recorded on-chain.** The Access Issuer verifies a presentation with the
 *   credential protocol's verifier, including proof that the wallet is the holder's, and submits
 *   an attestation. The signature check is off-chain; this contract trusts the attester's reading
 *   of the credential and never claims otherwise.
 * - **Checked at grant.** The configured issuer must be active in the protocol, neither credential
 *   may be revoked, and the attested schema, checks, jurisdiction, investor class and screening
 *   time must meet the policy. A mismatch reverts and names itself.
 * - **Bounded.** A grant expires at the earlier of the credential's own expiry and the maximum
 *   validity from the time of grant.
 * - **Revocable at once.** The attester revokes; the supervisor withdraws with a written reason;
 *   anyone may void a grant whose credential the protocol has revoked, and anyone may suspend the
 *   gate once the protocol deactivates its issuer. Suspension is permanent: recovery is a new gate.
 * - **One question on the swap path.** {isAllowed} reads the grant's expiry and the suspension
 *   flag and never reverts. It makes no call to the protocol.
 * - **Fixed policy.** Every parameter is set at construction and never changes (ADR 0032).
 *
 * Stores no attribute value: only the path, the two credential identifiers, the expiry and a hash
 * of the evidence the attester keeps.
 */
contract PoolCredentialRegistry is AccessControl {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant SUPERVISOR_ROLE = keccak256("SUPERVISOR_ROLE");

    /// @notice Checks the attester reports as passed, one bit each.
    uint32 public constant CHECK_WALLET_CONTROL = 1 << 0;
    uint32 public constant CHECK_NOT_EXPIRED = 1 << 1;
    uint32 public constant CHECK_ENTITY_ACTIVE = 1 << 2;
    uint32 public constant CHECK_OVER_18 = 1 << 3;
    uint32 public constant CHECK_SANCTIONS_CLEAN = 1 << 4;
    uint32 public constant CHECK_NOT_PEP = 1 << 5;
    uint32 private constant KNOWN_CHECKS = (1 << 6) - 1;

    /// @notice Investor classes, in the order the protocol's screening schema lists them. A
    ///         class is accepted when bit `1 << class` is set in {INVESTOR_CLASSES}.
    uint8 public constant CLASS_SOPHISTICATED = 0;
    uint8 public constant CLASS_PROFESSIONAL = 1;
    uint8 public constant CLASS_INSTITUTIONAL = 2;
    uint8 public constant CLASS_RETAIL = 3;

    /// @dev The longest revocation-root freshness window that may be configured.
    uint40 private constant MAX_FRESHNESS = 365 days;

    enum Path {
        None,
        Entity,
        Person
    }

    /// @dev A path whose screening schema is its primary schema carries its screening inside the
    ///      primary credential, as the entity path's corporate identity does (ADR 0033): one
    ///      credential, named in both places.
    struct PathPolicy {
        bytes32 primarySchema; // keccak256 of the schema URI: corporate identity, or passport
        bytes32 screeningSchema; // keccak256 of the screening schema URI, or the primary's
        uint32 requiredChecks;
    }

    struct Config {
        address admin;
        address attester;
        ICredentialIssuers issuers;
        ICredentialRevocations revocations;
        string issuerDid;
        PathPolicy entity;
        PathPolicy person;
        bytes2[] jurisdictions; // ISO 3166-1 alpha-2
        uint8 investorClasses;
        uint40 maxValidity;
        uint40 screeningMaxAge;
        uint40 rootFreshness; // zero: not required
    }

    /// @notice What the attester read from the holder's presentation.
    struct Attestation {
        address account;
        Path path;
        bytes32 primaryCredential;
        bytes32 screeningCredential;
        bytes32 primarySchema;
        bytes32 screeningSchema;
        uint32 checks;
        bytes2 jurisdiction;
        uint8 investorClass;
        uint40 screenedAt;
        uint40 credentialExpiry;
        bytes32 evidence; // hash of the verification record the attester keeps off-chain
    }

    struct Grant {
        uint40 expiresAt;
        Path path;
        bytes32 primaryCredential;
        bytes32 screeningCredential;
        bytes32 evidence;
    }

    ICredentialIssuers public immutable ISSUERS;
    ICredentialRevocations public immutable REVOCATIONS;
    bytes32 public immutable ISSUER_ID;
    uint8 public immutable INVESTOR_CLASSES;
    uint40 public immutable MAX_VALIDITY;
    uint40 public immutable SCREENING_MAX_AGE;
    uint40 public immutable ROOT_FRESHNESS;

    bytes32 private immutable ENTITY_PRIMARY_SCHEMA;
    bytes32 private immutable ENTITY_SCREENING_SCHEMA;
    uint32 private immutable ENTITY_CHECKS;
    bytes32 private immutable PERSON_PRIMARY_SCHEMA;
    bytes32 private immutable PERSON_SCREENING_SCHEMA;
    uint32 private immutable PERSON_CHECKS;

    /// @notice The configured issuer's identifier, as the protocol's registries key it.
    string public issuerDid;
    /// @notice Set once the protocol has deactivated the issuer. Never cleared.
    bool public issuerSuspended;

    bytes2[] private _jurisdictionList;
    mapping(bytes2 jurisdiction => bool) public isJurisdictionAllowed;
    mapping(address account => Grant) private _grants;

    event AccessGranted(
        address indexed account,
        Path path,
        bytes32 indexed primaryCredential,
        bytes32 screeningCredential,
        uint40 expiresAt,
        bytes32 evidence
    );
    event AccessRevoked(address indexed account, address indexed by);
    event AccessWithdrawn(address indexed account, string reason);
    event AccessVoided(address indexed account, bytes32 indexed credential);
    event IssuerSuspended(string did);

    error InvalidConfiguration(string reason);
    error InvalidAccount();
    error InvalidPath();
    error IssuerIsSuspended();
    error IssuerNotActive();
    error RootNotRecent();
    error CredentialRevoked(bytes32 credential);
    error SchemaNotAccepted(bytes32 schema);
    error ScreeningNotInCredential(bytes32 screeningCredential);
    error ChecksMissing(uint32 missing);
    error JurisdictionNotAllowed(bytes2 jurisdiction);
    error InvestorClassNotAllowed(uint8 investorClass);
    error ScreeningTooOld(uint40 screenedAt);
    error CredentialExpired(uint40 expiry);
    error NoGrant(address account);
    error NotVoidable(address account);
    error IssuerStillActive();
    error NoReason();

    constructor(Config memory c) {
        if (c.admin == address(0) || c.attester == address(0)) revert InvalidConfiguration("zero role holder");
        if (address(c.issuers) == address(0) || address(c.revocations) == address(0)) {
            revert InvalidConfiguration("zero protocol registry");
        }
        if (bytes(c.issuerDid).length == 0) revert InvalidConfiguration("no issuer");
        if (c.maxValidity == 0 || c.screeningMaxAge == 0) revert InvalidConfiguration("zero period");
        if (c.rootFreshness > MAX_FRESHNESS) revert InvalidConfiguration("freshness window too long");
        if (c.investorClasses == 0 || c.investorClasses >= 1 << 4) revert InvalidConfiguration("investor classes");
        if (c.jurisdictions.length == 0) revert InvalidConfiguration("no jurisdiction");
        _checkPolicy(c.entity);
        _checkPolicy(c.person);

        for (uint256 k = 0; k < c.jurisdictions.length; ++k) {
            bytes2 j = c.jurisdictions[k];
            if (!_isAlpha2(j) || isJurisdictionAllowed[j]) revert InvalidConfiguration("jurisdiction");
            isJurisdictionAllowed[j] = true;
            _jurisdictionList.push(j);
        }

        ISSUERS = c.issuers;
        REVOCATIONS = c.revocations;
        issuerDid = c.issuerDid;
        ISSUER_ID = keccak256(bytes(c.issuerDid));
        INVESTOR_CLASSES = c.investorClasses;
        MAX_VALIDITY = c.maxValidity;
        SCREENING_MAX_AGE = c.screeningMaxAge;
        ROOT_FRESHNESS = c.rootFreshness;
        ENTITY_PRIMARY_SCHEMA = c.entity.primarySchema;
        ENTITY_SCREENING_SCHEMA = c.entity.screeningSchema;
        ENTITY_CHECKS = c.entity.requiredChecks;
        PERSON_PRIMARY_SCHEMA = c.person.primarySchema;
        PERSON_SCREENING_SCHEMA = c.person.screeningSchema;
        PERSON_CHECKS = c.person.requiredChecks;

        _grantRole(DEFAULT_ADMIN_ROLE, c.admin);
        _grantRole(ATTESTER_ROLE, c.attester);
    }

    // ------------------------------------------------------------------------------------------
    // The swap path
    // ------------------------------------------------------------------------------------------

    /// @notice True while the account holds an unexpired grant and the issuer is not suspended.
    function isAllowed(address account) external view returns (bool) {
        return !issuerSuspended && _grants[account].expiresAt > block.timestamp;
    }

    // ------------------------------------------------------------------------------------------
    // Writing and removing grants
    // ------------------------------------------------------------------------------------------

    /// @notice Writes, or renews, the account's grant from a verified presentation.
    function grant(Attestation calldata a) external onlyRole(ATTESTER_ROLE) returns (uint40 expiresAt) {
        if (a.account == address(0)) revert InvalidAccount();
        if (issuerSuspended) revert IssuerIsSuspended();
        expiresAt = _checkAttestation(a);

        string memory did = issuerDid;
        if (!ISSUERS.isActive(did)) revert IssuerNotActive();
        if (REVOCATIONS.isRevoked(did, a.primaryCredential)) revert CredentialRevoked(a.primaryCredential);
        if (REVOCATIONS.isRevoked(did, a.screeningCredential)) revert CredentialRevoked(a.screeningCredential);
        if (ROOT_FRESHNESS != 0 && !REVOCATIONS.isRootRecent(did, REVOCATIONS.currentRoot(did), ROOT_FRESHNESS)) {
            revert RootNotRecent();
        }

        _grants[a.account] = Grant(expiresAt, a.path, a.primaryCredential, a.screeningCredential, a.evidence);
        emit AccessGranted(a.account, a.path, a.primaryCredential, a.screeningCredential, expiresAt, a.evidence);
    }

    /// @notice The attester removes a grant, for example when a presentation is superseded.
    function revoke(address account) external onlyRole(ATTESTER_ROLE) {
        _remove(account);
        emit AccessRevoked(account, msg.sender);
    }

    /// @notice Supervisory withdrawal, at once, with the written reason emitted in full.
    function withdraw(address account, string calldata reason) external onlyRole(SUPERVISOR_ROLE) {
        if (bytes(reason).length == 0) revert NoReason();
        _remove(account);
        emit AccessWithdrawn(account, reason);
    }

    /// @notice Removes a grant whose credential the protocol has revoked. Anyone may call.
    function void(address account) external {
        Grant storage g = _grants[account];
        if (g.expiresAt == 0) revert NoGrant(account);
        string memory did = issuerDid;
        bytes32 revoked;
        if (REVOCATIONS.isRevoked(did, g.primaryCredential)) revoked = g.primaryCredential;
        else if (REVOCATIONS.isRevoked(did, g.screeningCredential)) revoked = g.screeningCredential;
        else revert NotVoidable(account);
        delete _grants[account];
        emit AccessVoided(account, revoked);
    }

    /// @notice Suspends every grant once the protocol has deactivated the issuer. Anyone may call.
    function suspendIssuer() external {
        if (issuerSuspended) revert IssuerIsSuspended();
        if (ISSUERS.isActive(issuerDid)) revert IssuerStillActive();
        issuerSuspended = true;
        emit IssuerSuspended(issuerDid);
    }

    // ------------------------------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------------------------------

    function grantOf(address account) external view returns (Grant memory) {
        return _grants[account];
    }

    function pathPolicy(Path path) public view returns (PathPolicy memory) {
        if (path == Path.Entity) return PathPolicy(ENTITY_PRIMARY_SCHEMA, ENTITY_SCREENING_SCHEMA, ENTITY_CHECKS);
        if (path == Path.Person) return PathPolicy(PERSON_PRIMARY_SCHEMA, PERSON_SCREENING_SCHEMA, PERSON_CHECKS);
        revert InvalidPath();
    }

    function jurisdictions() external view returns (bytes2[] memory) {
        return _jurisdictionList;
    }

    // ------------------------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------------------------

    /// @dev Checks the attested values against the policy, and returns the grant's expiry.
    function _checkAttestation(Attestation calldata a) private view returns (uint40 expiresAt) {
        PathPolicy memory p = pathPolicy(a.path);
        if (a.primarySchema != p.primarySchema) revert SchemaNotAccepted(a.primarySchema);
        if (a.screeningSchema != p.screeningSchema) revert SchemaNotAccepted(a.screeningSchema);
        if (p.screeningSchema == p.primarySchema && a.screeningCredential != a.primaryCredential) {
            revert ScreeningNotInCredential(a.screeningCredential);
        }
        uint32 missing = p.requiredChecks & ~a.checks;
        if (missing != 0) revert ChecksMissing(missing);
        if (!isJurisdictionAllowed[a.jurisdiction]) revert JurisdictionNotAllowed(a.jurisdiction);
        if (a.investorClass > CLASS_RETAIL || INVESTOR_CLASSES & (1 << a.investorClass) == 0) {
            revert InvestorClassNotAllowed(a.investorClass);
        }
        uint40 nowTs = uint40(block.timestamp);
        if (a.screenedAt > nowTs || nowTs - a.screenedAt > SCREENING_MAX_AGE) revert ScreeningTooOld(a.screenedAt);
        if (a.credentialExpiry <= nowTs) revert CredentialExpired(a.credentialExpiry);

        uint40 cap = nowTs + MAX_VALIDITY;
        expiresAt = a.credentialExpiry < cap ? a.credentialExpiry : cap;
    }

    function _remove(address account) private {
        if (_grants[account].expiresAt == 0) revert NoGrant(account);
        delete _grants[account];
    }

    function _checkPolicy(PathPolicy memory p) private pure {
        if (p.primarySchema == bytes32(0) || p.screeningSchema == bytes32(0)) revert InvalidConfiguration("schema");
        if (p.requiredChecks == 0 || p.requiredChecks & ~KNOWN_CHECKS != 0) revert InvalidConfiguration("checks");
        if (p.requiredChecks & CHECK_WALLET_CONTROL == 0) revert InvalidConfiguration("wallet control not required");
    }

    function _isAlpha2(bytes2 j) private pure returns (bool) {
        bytes1 a = j[0];
        bytes1 b = j[1];
        return a >= "A" && a <= "Z" && b >= "A" && b <= "Z";
    }
}
