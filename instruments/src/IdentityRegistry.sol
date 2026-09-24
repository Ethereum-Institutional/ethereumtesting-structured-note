// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/**
 * @title IdentityRegistry
 * @notice Grants of record: rights and attribute flags, jurisdiction and expiry per address,
 *         written by a registrar's issuing key once a credential has been verified off-chain.
 *
 * Eligibility is established cryptographically off-chain, recorded here, bounded in time and
 * revocable immediately. It is not verified on-chain at every transfer, and nothing in this
 * contract should be described as if it were.
 *
 * - **Bounded in time.** Every grant expires, at most `maxValidity` after it is written, and
 *   lapses with no further action. Renewal is a fresh grant after a fresh presentation.
 * - **Revocable immediately.** A registrar revokes a grant with one call. The supervisor can
 *   withdraw any grant, whichever registrar wrote it, with a written reason.
 * - **Scoped by registrar.** Each issuing key belongs to one registrar. A registrar may write,
 *   renew and revoke only the grants it wrote, so onboarding authority can be delegated to a
 *   further institution without giving it any power over the Agent's participants.
 * - **One read per check.** The fields a gate needs share one storage slot. The credential
 *   reference and the salted commitment to the off-chain record are stored separately and
 *   never read on a transfer path.
 *
 * The admin (the Agent's multi-signature, from Wave 4) appoints issuing keys and sets the
 * validity window. It writes no grants itself: issuing keys are operator keys, distinct from it.
 *
 * Supervisory withdrawal is the Agent acting over the whole whitelist, not as a registrar, for
 * the case where another registrar's participant must be stopped at once, such as a sanctions
 * designation. It only restricts, so it carries no delay, and its reason is emitted as text. Its
 * role is held by the governance controller from Wave 4, and by no one before.
 */
contract IdentityRegistry is IIdentityRegistry, AccessControl {
    // Rights.
    uint32 public constant HOLD = 1 << 0;
    uint32 public constant RECEIVE = 1 << 1;
    uint32 public constant TRANSFER = 1 << 2;
    uint32 public constant SWAP = 1 << 3;
    uint32 public constant PROVIDE_LIQUIDITY = 1 << 4;
    // Attributes carrying regulatory meaning, determined by the Agent from its own file.
    uint32 public constant REG_S = 1 << 8;
    uint32 public constant RULE_144A = 1 << 9;
    uint32 public constant PROFESSIONAL = 1 << 10;
    uint32 public constant ACCREDITED = 1 << 11;
    uint32 public constant QIB = 1 << 12;
    uint32 public constant SANCTIONS_CLEAR = 1 << 13;
    /// @dev Set when the address is a contract account, from the wallet control credential.
    uint32 public constant CONTRACT_ACCOUNT = 1 << 14;

    bytes32 public constant SUPERVISOR_ROLE = keccak256("SUPERVISOR_ROLE");

    uint40 public maxValidity;
    mapping(address issuingKey => uint16) public registrarOf;

    mapping(address account => Grant) private _grants;
    mapping(address account => bytes32) public credentialRefOf;
    mapping(address account => bytes32) public commitmentOf;

    constructor(address admin, uint40 maxValidity_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _setMaxValidity(maxValidity_);
    }

    // --- admin ---

    /// @notice Appoints an issuing key to a registrar, or removes it with registrar zero.
    function setRegistrar(address issuingKey, uint16 registrar) external onlyRole(DEFAULT_ADMIN_ROLE) {
        registrarOf[issuingKey] = registrar;
        emit RegistrarSet(issuingKey, registrar);
    }

    /// @notice The longest a grant may run. Bounds how long the on-chain answer can be stale.
    function setMaxValidity(uint40 maxValidity_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setMaxValidity(maxValidity_);
    }

    // --- registrars ---

    /**
     * @notice Writes or renews a grant after a verified presentation.
     * @param credentialRef Reference to the presented credential, for the audit trail.
     * @param commitment Salted commitment to the off-chain record. A party holding the record
     *        can check it; a party without it derives nothing.
     */
    function grant(
        address account,
        uint32 flags,
        uint16 jurisdiction,
        uint40 expiresAt,
        bytes32 credentialRef,
        bytes32 commitment
    ) external {
        uint16 registrar = _callerRegistrar();
        Grant storage g = _grants[account];
        if (g.registrar != 0 && g.registrar != registrar) revert NotYourParticipant(account, g.registrar);
        uint40 latest = uint40(block.timestamp) + maxValidity;
        if (expiresAt <= block.timestamp || expiresAt > latest) revert ExpiryOutOfRange(expiresAt, latest);

        _grants[account] = Grant(flags, jurisdiction, registrar, uint40(block.timestamp), expiresAt);
        credentialRefOf[account] = credentialRef;
        commitmentOf[account] = commitment;
        emit Granted(account, registrar, flags, jurisdiction, expiresAt, credentialRef, commitment);
    }

    /// @notice Withdraws a grant at once. Frees the address to be onboarded by any registrar.
    function revoke(address account) external {
        uint16 registrar = _callerRegistrar();
        Grant storage g = _grants[account];
        if (g.registrar == 0) revert NoGrant(account);
        if (g.registrar != registrar) revert NotYourParticipant(account, g.registrar);
        delete _grants[account];
        delete credentialRefOf[account];
        delete commitmentOf[account];
        emit Revoked(account, registrar);
    }

    // --- supervisor ---

    /// @notice Withdraws any grant at once, whichever registrar wrote it. The reason is required.
    function withdraw(address account, string calldata reason) external onlyRole(SUPERVISOR_ROLE) {
        if (bytes(reason).length == 0) revert NoReason();
        uint16 registrar = _grants[account].registrar;
        if (registrar == 0) revert NoGrant(account);
        delete _grants[account];
        delete credentialRefOf[account];
        delete commitmentOf[account];
        emit Withdrawn(account, registrar, reason);
    }

    // --- reads ---

    /// @inheritdoc IIdentityRegistry
    function grantOf(address account) external view returns (Grant memory) {
        return _grants[account];
    }

    /// @inheritdoc IIdentityRegistry
    function liveFlags(address account) external view returns (uint32 flags, uint16 jurisdiction) {
        Grant memory g = _grants[account];
        if (g.expiresAt <= block.timestamp) return (0, 0);
        return (g.flags, g.jurisdiction);
    }

    // --- internal ---

    function _callerRegistrar() private view returns (uint16 registrar) {
        registrar = registrarOf[msg.sender];
        if (registrar == 0) revert NotAnIssuingKey(msg.sender);
    }

    function _setMaxValidity(uint40 maxValidity_) private {
        maxValidity = maxValidity_;
        emit MaxValiditySet(maxValidity_);
    }
}
