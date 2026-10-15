// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.30;

import {INote, IRecordDates, IOwnable2Step, AgentRestrictions} from "./interfaces/INote.sol";

interface IThresholdWallet {
    function getThreshold() external view returns (uint256);
}

/// @dev The note's trusted issuers registry: which institutions' claims it accepts, for which topics.
interface IGovernedIssuers {
    function addTrustedIssuer(address issuer, uint256[] calldata topics) external;
    function removeTrustedIssuer(address issuer) external;
    function updateIssuerClaimTopics(address issuer, uint256[] calldata topics) external;
    function isTrustedIssuer(address issuer) external view returns (bool);
}

interface IGovernedPayingAgent {
    function INVENTORY() external view returns (address);
    function reverse(bytes32 id, address[] calldata holders, string calldata reason) external;
    function restate(bytes32 original, uint48 recordTime, string calldata reason) external returns (bytes32);
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
}

/// @dev The venue's contracts are in the other compilation unit; the controller reaches them here.
interface IGovernedChecker {
    function setCredentialGate(address token, address gate) external;
    function setLiquidityApproved(address token, address account, bool approved) external;
    function acceptOwnership() external;
}

interface IGovernedAdapter {
    function updateAllowedWrapper(address wrapper, bool allowed) external;
    function updateAllowedHook(address hook, bool allowed) external;
    function updateSwappingEnabled(bool enabled) external;
    function acceptOwnership() external;
}

/// @dev The pool's gate (ADR 0090): supervisory withdrawal over the pool's identity registry,
///      whose trusted issuers decide who may vouch for pool access.
interface IGovernedPoolGate {
    function withdraw(address account, string calldata reason) external;
    function restore(address account, string calldata reason) external;
    function registry() external view returns (address);
}

interface IPoolRegistry {
    function issuersRegistry() external view returns (address);
}

/**
 * @title GovernanceController
 * @notice Every privileged power over the note, its identities, the Paying Agent and the
 *         conversion venue, exercised in two tiers through a fixed set of typed acts, and nothing
 *         else. The note is an ERC-3643 token (T-REX): this controller owns it and its registries,
 *         and is one of its agents, with only the powers its acts need (ADRs 0085, 0088).
 *
 * - **No general call path** (section 7, ADR 0021). Each permitted act is its own entry point
 *   with typed arguments; a proposal stores those arguments, never calldata, and the controller
 *   builds every downstream call itself. This source is the complete permitted set.
 * - **Tier 1, register correction** (overview; ADR 0025). The Agent's governance wallet alone,
 *   with no delay, each act carrying its written reason in full:
 *   - correcting the note's register by a forced transfer;
 *   - freezing or unfreezing an account at once, whichever institution vouched for it, as a
 *     supervisory stop (ADR 0004);
 *   - recovering a holder's units from a lost wallet to a new one (S-25), which ERC-3643 does
 *     natively, never while transfers are stopped at a Record Time.
 * - **Tier 2, intervention.** Proposed and approved by the institution wallets. It is queued once
 *   approvals come from at least `MIN_INSTITUTIONS` institutions whose wallets' own thresholds sum
 *   to at least `MIN_SIGNATURES` (ADR 0022), and can be executed after `TIER2_DELAY` (ADR 0023).
 *   Thresholds are checked again at execution. The reason is stored and emitted in full, because a
 *   notice that needs an off-chain lookup is not notice.
 * - **Whose claims the note accepts** is Tier 2: trusting an institution's claim issuer for the
 *   note's claim topics, changing them, or ceasing to trust it.
 * - **Expiry** (S-24, ADR 0082). A queued proposal not executed within `EXECUTION_WINDOW` of
 *   becoming ready expires: it can no longer be executed, approved or cancelled, and acting on it
 *   again means proposing it afresh, with fresh approvals.
 * - **Recovery of an institution** (ADR 0019). Replacing an institution's wallet needs every other
 *   institution and the longer `RECOVERY_DELAY`, and the wallet being replaced can cancel it if it
 *   still works.
 * - **The venue** (ADRs 0039, 0090). The controller owns the venue checker, the deposit's
 *   permissions adapter and the pool's identity registries, and supervises the pool's gate. The
 *   servicing wallet switches swapping off and on; withdrawing and restoring pool access is
 *   Tier 1; every other venue act, which issuers may vouch for pool access among them, is Tier 2.
 * - **Nothing is upgradeable.** The note's implementation is fixed by the T-REX implementation
 *   authority, which no one owns after deployment, and no act changes the thresholds or the delays.
 */
contract GovernanceController {
    enum Kind {
        AmendNotional,
        ReverseDistribution,
        RestateDistribution,
        SetTrustedIssuer,
        ReplaceServicingWallet,
        ReplaceInstitution,
        SetCredentialGate,
        SetLiquidityProvider,
        SetVenueWrapper,
        SetVenueHook,
        SetPoolIssuer
    }

    struct Proposal {
        Kind kind;
        address proposer;
        uint48 readyAt;
        bool executed;
        bool cancelled;
        bytes args;
        string reason;
    }

    bytes32 private constant PAYER_ROLE = keccak256("PAYER_ROLE");
    /// @dev The pool-access claim topic, keccak256("claim.pool-access") (ADR 0090).
    uint256 private constant POOL_ACCESS = uint256(keccak256("claim.pool-access"));

    INote public immutable NOTE;
    /// @notice The deposit, as the venue's checker knows it.
    address public immutable DEPOSIT;
    /// @notice The note's trusted issuers registry.
    IGovernedIssuers public immutable TRUSTED_ISSUERS;
    /// @notice The note's record dates, which a wallet recovery must keep in step.
    IRecordDates public immutable RECORD_DATES;
    IGovernedPayingAgent public immutable PAYING_AGENT;
    /// @notice The venue checker and the deposit's permissions adapter; zero where no venue.
    IGovernedChecker public immutable CHECKER;
    IGovernedAdapter public immutable ADAPTER;

    uint256 public immutable MIN_INSTITUTIONS;
    uint256 public immutable MIN_SIGNATURES;
    uint48 public immutable TIER2_DELAY;
    uint48 public immutable RECOVERY_DELAY;
    /// @notice How long a queued proposal stays executable once its delay has run (S-24).
    uint48 public immutable EXECUTION_WINDOW;

    address[] private _institutions;
    mapping(address wallet => bool) public isInstitution;
    /// @notice The Agent's governance wallet: an institution, and the only Tier 1 actor.
    address public agentGovernance;
    /// @notice The Agent's servicing wallet (ADR 0025), replaceable only by Tier 2.
    address public servicingWallet;
    /// @notice The pool's current gate (ADR 0090), replaceable only by Tier 2.
    address public credentialGate;

    uint256 public proposalCount;
    mapping(uint256 id => Proposal) private _proposals;
    mapping(uint256 id => mapping(address wallet => bool)) public approvedBy;

    event Tier1(string action, string reason);
    event Proposed(uint256 indexed id, Kind kind, address indexed proposer, bytes args, string reason);
    event Approved(uint256 indexed id, address indexed wallet);
    event Queued(uint256 indexed id, uint48 readyAt);
    event Executed(uint256 indexed id);
    event Cancelled(uint256 indexed id, address by);
    event InstitutionReplaced(address indexed oldWallet, address indexed newWallet);
    event ServicingWalletReplaced(address indexed oldWallet, address indexed newWallet);
    event VenueSwapping(bool enabled);
    event CredentialGateReplaced(address indexed oldGate, address indexed newGate);

    error InvalidConfiguration(string reason);
    error NotAgentGovernance(address caller);
    error NotAnInstitution(address caller);
    error NoReason();
    error UnknownProposal(uint256 id);
    error NotOpen(uint256 id);
    error AlreadyApproved(address wallet);
    error ThresholdsNotMet(uint256 institutions, uint256 signatures);
    error NotReady(uint48 readyAt);
    error NotCancellable(address caller);
    error InvalidArgument();
    error NotServicingWallet(address caller);
    error NoVenue();
    error Expired(uint256 id, uint48 expiredAt);
    error TransfersClosed();

    struct Config {
        address note;
        address deposit;
        address trustedIssuers;
        address recordDates;
        address payingAgent;
        address[] institutions;
        address agentGovernance;
        address servicingWallet;
        uint256 minInstitutions;
        uint256 minSignatures;
        uint48 tier2Delay;
        uint48 recoveryDelay;
        uint48 executionWindow;
        address checker;
        address adapter;
        address credentialGate;
    }

    constructor(Config memory c) {
        if (c.tier2Delay == 0) revert InvalidConfiguration("Tier 2 delay is zero");
        if (c.recoveryDelay <= c.tier2Delay) revert InvalidConfiguration("recovery delay not longer than Tier 2");
        if (c.executionWindow == 0) revert InvalidConfiguration("execution window is zero");
        if (c.minInstitutions < 2) revert InvalidConfiguration("fewer than two institutions required");
        if (c.institutions.length < c.minInstitutions) revert InvalidConfiguration("too few institutions");
        if (c.minSignatures < c.minInstitutions) revert InvalidConfiguration("fewer signatures than institutions");
        if (c.servicingWallet == address(0)) revert InvalidConfiguration("no servicing wallet");
        for (uint256 k = 0; k < c.institutions.length; ++k) {
            address w = c.institutions[k];
            if (w == address(0) || isInstitution[w]) revert InvalidConfiguration("institution repeated or zero");
            if (w == c.servicingWallet) revert InvalidConfiguration("servicing wallet is an institution");
            isInstitution[w] = true;
            _institutions.push(w);
        }
        if (!isInstitution[c.agentGovernance]) revert InvalidConfiguration("Agent governance is not an institution");
        NOTE = INote(c.note);
        DEPOSIT = c.deposit;
        TRUSTED_ISSUERS = IGovernedIssuers(c.trustedIssuers);
        RECORD_DATES = IRecordDates(c.recordDates);
        PAYING_AGENT = IGovernedPayingAgent(c.payingAgent);
        MIN_INSTITUTIONS = c.minInstitutions;
        MIN_SIGNATURES = c.minSignatures;
        TIER2_DELAY = c.tier2Delay;
        RECOVERY_DELAY = c.recoveryDelay;
        EXECUTION_WINDOW = c.executionWindow;
        agentGovernance = c.agentGovernance;
        servicingWallet = c.servicingWallet;

        // The venue is all or nothing.
        bool anyVenue = c.checker != address(0) || c.adapter != address(0) || c.credentialGate != address(0);
        bool wholeVenue = c.checker != address(0) && c.adapter != address(0) && c.credentialGate != address(0);
        if (anyVenue && !wholeVenue) revert InvalidConfiguration("venue incomplete");
        CHECKER = IGovernedChecker(c.checker);
        ADAPTER = IGovernedAdapter(c.adapter);
        credentialGate = c.credentialGate;
    }

    modifier withReason(string calldata reason) {
        if (bytes(reason).length == 0) revert NoReason();
        _;
    }

    // ------------------------------------------------------------------------------------------
    // The servicing wallet's restrictions, and the handover in the ceremony
    // ------------------------------------------------------------------------------------------

    /// @notice What the servicing wallet may do on the note as an agent: pause, and freeze part
    ///         of a holding. Address freezing, forced transfer and recovery are Tier 1 here;
    ///         minting and burning are the Issuer's, the Paying Agent's and Tier 2's.
    function servicingRestrictions() public pure returns (AgentRestrictions memory) {
        return AgentRestrictions({
            disableMint: true,
            disableBurn: true,
            disablePartialFreeze: false,
            disableAddressFreeze: true,
            disableRecovery: true,
            disableForceTransfer: true,
            disablePause: false
        });
    }

    /// @notice Completes the handover of ownership in the ceremony: the note and its registries,
    ///         and the venue where there is one. Anyone may call; it only accepts ownership that
    ///         was already transferred to this controller.
    function acceptOwnerships(address[] calldata owned) external {
        for (uint256 k = 0; k < owned.length; ++k) {
            IOwnable2Step(owned[k]).acceptOwnership();
        }
    }

    // ------------------------------------------------------------------------------------------
    // Tier 1: the Agent's governance wallet, no delay, written reason
    // ------------------------------------------------------------------------------------------

    /// @notice Corrects the note's on-chain register to match the Register (Tier 1).
    function correctRegister(address from, address to, uint256 units, string calldata reason)
        external
        withReason(reason)
    {
        _onlyAgentGovernance();
        NOTE.forcedTransfer(from, to, units);
        emit Tier1("correctRegister", reason);
    }

    /// @notice Freezes or unfreezes an account on the note at once, whichever institution vouched
    ///         for it (Tier 1, ADR 0004): the supervisory stop, for a sanctions designation.
    function freezeAccount(address account, bool frozen, string calldata reason) external withReason(reason) {
        _onlyAgentGovernance();
        NOTE.setAddressFrozen(account, frozen);
        emit Tier1(frozen ? "freezeAccount" : "unfreezeAccount", reason);
    }

    /**
     * @notice Recovers a holder's units from a lost wallet to its new one, with the identity
     *         re-registered to it (Tier 1, S-25). Refused while transfers are stopped at a Record
     *         Time, so the holder of record and the account paid stay the same.
     */
    function recoverWallet(address lostWallet, address newWallet, address identity, string calldata reason)
        external
        withReason(reason)
    {
        _onlyAgentGovernance();
        if (!RECORD_DATES.transfersOpen()) revert TransfersClosed();
        NOTE.recoveryAddress(lostWallet, newWallet, identity);
        address[] memory moved = new address[](2);
        (moved[0], moved[1]) = (lostWallet, newWallet);
        RECORD_DATES.sync(moved);
        emit Tier1("recoverWallet", reason);
    }

    /// @notice Withdraws an account's access to the conversion pool at once (Tier 1, ADR 0039).
    function withdrawPoolAccess(address account, string calldata reason) external withReason(reason) {
        _onlyAgentGovernance();
        _venue();
        IGovernedPoolGate(credentialGate).withdraw(account, reason);
        emit Tier1("withdrawPoolAccess", reason);
    }

    /// @notice Lifts a withdrawal of pool access (Tier 1). The account converts again only while
    ///         its pool-access claim is still valid.
    function restorePoolAccess(address account, string calldata reason) external withReason(reason) {
        _onlyAgentGovernance();
        _venue();
        IGovernedPoolGate(credentialGate).restore(account, reason);
        emit Tier1("restorePoolAccess", reason);
    }

    // ------------------------------------------------------------------------------------------
    // Servicing: the Agent's servicing wallet, no delay
    // ------------------------------------------------------------------------------------------

    /// @notice Switches swapping in the conversion pool off or on (ADR 0039).
    function setVenueSwapping(bool enabled) external {
        if (msg.sender != servicingWallet) revert NotServicingWallet(msg.sender);
        _venue();
        ADAPTER.updateSwappingEnabled(enabled);
        emit VenueSwapping(enabled);
    }

    // ------------------------------------------------------------------------------------------
    // Tier 2: proposals, one typed entry point per permitted act
    // ------------------------------------------------------------------------------------------

    /// @notice Tranches the notional up or reduces it, in the Issuer's inventory only.
    function proposeAmendNotional(bool increase, uint256 units, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        if (units == 0) revert InvalidArgument();
        return _propose(Kind.AmendNotional, abi.encode(increase, units), reason);
    }

    /// @notice Reverses a coupon for the given holders, each against its original credit (ADR 0014).
    function proposeReverseDistribution(bytes32 distribution, address[] calldata holders, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        if (holders.length == 0) revert InvalidArgument();
        return _propose(Kind.ReverseDistribution, abi.encode(distribution, holders), reason);
    }

    /// @notice Restates a reversed coupon against a corrected Record Time (ADR 0014).
    function proposeRestateDistribution(bytes32 original, uint48 recordTime, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        return _propose(Kind.RestateDistribution, abi.encode(original, recordTime), reason);
    }

    /**
     * @notice Trusts an institution's claim issuer for the given claim topics of the note, changes
     *         the topics it is trusted for, or, with no topics, ceases to trust it.
     */
    function proposeSetTrustedIssuer(address issuer, uint256[] calldata topics, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        if (issuer == address(0)) revert InvalidArgument();
        if (topics.length == 0 && !TRUSTED_ISSUERS.isTrustedIssuer(issuer)) revert InvalidArgument();
        return _propose(Kind.SetTrustedIssuer, abi.encode(issuer, topics), reason);
    }

    /// @notice Moves every servicing power from the servicing wallet to a new one, as one act.
    function proposeReplaceServicingWallet(address newWallet, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        if (newWallet == address(0) || isInstitution[newWallet]) revert InvalidArgument();
        return _propose(Kind.ReplaceServicingWallet, abi.encode(newWallet), reason);
    }

    /// @notice Recovery: replaces an institution's wallet (ADR 0019).
    function proposeReplaceInstitution(address oldWallet, address newWallet, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        if (!isInstitution[oldWallet] || newWallet == address(0) || isInstitution[newWallet]) {
            revert InvalidArgument();
        }
        if (newWallet == servicingWallet) revert InvalidArgument();
        return _propose(Kind.ReplaceInstitution, abi.encode(oldWallet, newWallet), reason);
    }

    /// @notice Points the venue checker at a new gate for the deposit.
    function proposeSetCredentialGate(address gate, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        _venue();
        if (gate == address(0)) revert InvalidArgument();
        return _propose(Kind.SetCredentialGate, abi.encode(gate), reason);
    }

    /// @notice Approves an account to provide liquidity in the pool, or removes the approval.
    function proposeSetLiquidityProvider(address account, bool approved, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        _venue();
        if (account == address(0)) revert InvalidArgument();
        return _propose(Kind.SetLiquidityProvider, abi.encode(account, approved), reason);
    }

    /// @notice Allows or refuses a router or position manager on the deposit's adapter.
    function proposeSetVenueWrapper(address wrapper, bool allowed, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        _venue();
        if (wrapper == address(0)) revert InvalidArgument();
        return _propose(Kind.SetVenueWrapper, abi.encode(wrapper, allowed), reason);
    }

    /// @notice Allows or refuses a hook on the deposit's adapter.
    function proposeSetVenueHook(address hook, bool allowed, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        _venue();
        if (hook == address(0)) revert InvalidArgument();
        return _propose(Kind.SetVenueHook, abi.encode(hook, allowed), reason);
    }

    /// @notice Trusts a claim issuer to vouch for pool access, or stops trusting it, on the
    ///         identity registry of the pool's current gate (ADR 0090).
    function proposeSetPoolIssuer(address issuer, bool trusted, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        _venue();
        if (issuer == address(0)) revert InvalidArgument();
        return _propose(Kind.SetPoolIssuer, abi.encode(issuer, trusted), reason);
    }

    // ------------------------------------------------------------------------------------------
    // Tier 2: approval, timelock, execution
    // ------------------------------------------------------------------------------------------

    function approve(uint256 id) external {
        Proposal storage p = _open(id);
        if (!isInstitution[msg.sender]) revert NotAnInstitution(msg.sender);
        if (approvedBy[id][msg.sender]) revert AlreadyApproved(msg.sender);
        approvedBy[id][msg.sender] = true;
        emit Approved(id, msg.sender);
        if (p.readyAt == 0 && _thresholdsMet(id, p)) {
            p.readyAt = uint48(block.timestamp) + (p.kind == Kind.ReplaceInstitution ? RECOVERY_DELAY : TIER2_DELAY);
            emit Queued(id, p.readyAt);
        }
    }

    /// @notice Executes a queued proposal once its delay has run. Anyone may call.
    function execute(uint256 id) external {
        Proposal storage p = _open(id);
        if (p.readyAt == 0 || block.timestamp < p.readyAt) revert NotReady(p.readyAt);
        if (!_thresholdsMet(id, p)) {
            (uint256 i, uint256 s) = _count(id);
            revert ThresholdsNotMet(i, s);
        }
        p.executed = true;
        _dispatch(p);
        emit Executed(id);
    }

    /// @notice The proposer may cancel; so may the wallet a recovery would replace.
    function cancel(uint256 id) external {
        Proposal storage p = _open(id);
        bool isOld;
        if (p.kind == Kind.ReplaceInstitution) {
            (address oldWallet,) = abi.decode(p.args, (address, address));
            isOld = msg.sender == oldWallet;
        }
        if (msg.sender != p.proposer && !isOld) revert NotCancellable(msg.sender);
        p.cancelled = true;
        emit Cancelled(id, msg.sender);
    }

    // --- reads ---

    function proposal(uint256 id) external view returns (Proposal memory) {
        return _proposals[id];
    }

    /// @notice Whether a queued proposal's execution window has passed (S-24).
    function expired(uint256 id) public view returns (bool) {
        Proposal storage p = _proposals[id];
        return p.readyAt != 0 && !p.executed && !p.cancelled && block.timestamp > uint256(p.readyAt) + EXECUTION_WINDOW;
    }

    function institutions() external view returns (address[] memory) {
        return _institutions;
    }

    /// @notice Institutions approving, and the signatures their wallets require between them.
    function approvals(uint256 id) external view returns (uint256 institutionCount, uint256 signatures) {
        return _count(id);
    }

    // --- internal ---

    function _propose(Kind kind, bytes memory args, string calldata reason) private returns (uint256 id) {
        if (!isInstitution[msg.sender]) revert NotAnInstitution(msg.sender);
        id = ++proposalCount;
        Proposal storage p = _proposals[id];
        p.kind = kind;
        p.proposer = msg.sender;
        p.args = args;
        p.reason = reason;
        emit Proposed(id, kind, msg.sender, args, reason);
        approvedBy[id][msg.sender] = true;
        emit Approved(id, msg.sender);
        if (_thresholdsMet(id, p)) {
            p.readyAt = uint48(block.timestamp) + (kind == Kind.ReplaceInstitution ? RECOVERY_DELAY : TIER2_DELAY);
            emit Queued(id, p.readyAt);
        }
    }

    function _open(uint256 id) private view returns (Proposal storage p) {
        if (id == 0 || id > proposalCount) revert UnknownProposal(id);
        p = _proposals[id];
        if (p.executed || p.cancelled) revert NotOpen(id);
        if (expired(id)) revert Expired(id, p.readyAt + EXECUTION_WINDOW);
    }

    /// @dev Counts approvals from current institutions only, so a replaced wallet's approval lapses.
    function _count(uint256 id) private view returns (uint256 count, uint256 signatures) {
        for (uint256 k = 0; k < _institutions.length; ++k) {
            address w = _institutions[k];
            if (!approvedBy[id][w]) continue;
            count += 1;
            signatures += _threshold(w);
        }
    }

    function _thresholdsMet(uint256 id, Proposal storage p) private view returns (bool) {
        if (p.kind == Kind.ReplaceInstitution) {
            // Every institution other than the one being replaced.
            (address oldWallet,) = abi.decode(p.args, (address, address));
            for (uint256 k = 0; k < _institutions.length; ++k) {
                address w = _institutions[k];
                if (w != oldWallet && !approvedBy[id][w]) return false;
            }
            return true;
        }
        (uint256 count, uint256 signatures) = _count(id);
        return count >= MIN_INSTITUTIONS && signatures >= MIN_SIGNATURES;
    }

    /// @dev A wallet that does not answer counts for no signatures.
    function _threshold(address wallet) private view returns (uint256) {
        try IThresholdWallet(wallet).getThreshold() returns (uint256 t) {
            return t;
        } catch {
            return 0;
        }
    }

    function _dispatch(Proposal storage p) private {
        Kind k = p.kind;
        if (k == Kind.AmendNotional) {
            (bool increase, uint256 units) = abi.decode(p.args, (bool, uint256));
            address inventory = PAYING_AGENT.INVENTORY();
            if (increase) NOTE.mint(inventory, units);
            else NOTE.burn(inventory, units);
        } else if (k == Kind.ReverseDistribution) {
            (bytes32 id, address[] memory holders) = abi.decode(p.args, (bytes32, address[]));
            PAYING_AGENT.reverse(id, holders, p.reason);
        } else if (k == Kind.RestateDistribution) {
            (bytes32 original, uint48 recordTime) = abi.decode(p.args, (bytes32, uint48));
            PAYING_AGENT.restate(original, recordTime, p.reason);
        } else if (k == Kind.SetTrustedIssuer) {
            (address issuer, uint256[] memory topics) = abi.decode(p.args, (address, uint256[]));
            if (topics.length == 0) TRUSTED_ISSUERS.removeTrustedIssuer(issuer);
            else if (TRUSTED_ISSUERS.isTrustedIssuer(issuer)) TRUSTED_ISSUERS.updateIssuerClaimTopics(issuer, topics);
            else TRUSTED_ISSUERS.addTrustedIssuer(issuer, topics);
        } else if (k == Kind.ReplaceServicingWallet) {
            _replaceServicing(abi.decode(p.args, (address)));
        } else if (k == Kind.ReplaceInstitution) {
            (address oldWallet, address newWallet) = abi.decode(p.args, (address, address));
            _replaceInstitution(oldWallet, newWallet);
        } else if (k == Kind.SetCredentialGate) {
            address gate = abi.decode(p.args, (address));
            CHECKER.setCredentialGate(DEPOSIT, gate);
            emit CredentialGateReplaced(credentialGate, gate);
            credentialGate = gate;
        } else if (k == Kind.SetLiquidityProvider) {
            (address account, bool approved) = abi.decode(p.args, (address, bool));
            CHECKER.setLiquidityApproved(DEPOSIT, account, approved);
        } else if (k == Kind.SetVenueWrapper) {
            (address wrapper, bool allowed) = abi.decode(p.args, (address, bool));
            ADAPTER.updateAllowedWrapper(wrapper, allowed);
        } else if (k == Kind.SetVenueHook) {
            (address hook, bool allowed) = abi.decode(p.args, (address, bool));
            ADAPTER.updateAllowedHook(hook, allowed);
        } else {
            (address issuer, bool trusted) = abi.decode(p.args, (address, bool));
            IGovernedIssuers issuers =
                IGovernedIssuers(IPoolRegistry(IGovernedPoolGate(credentialGate).registry()).issuersRegistry());
            if (!trusted) {
                issuers.removeTrustedIssuer(issuer);
            } else {
                uint256[] memory topics = new uint256[](1);
                topics[0] = POOL_ACCESS;
                issuers.addTrustedIssuer(issuer, topics);
            }
        }
    }

    /// @dev The servicing powers of ADR 0025, moved together: the note's agent, with the same
    ///      restrictions, and paying.
    function _replaceServicing(address newWallet) private {
        address old = servicingWallet;
        NOTE.removeAgent(old);
        NOTE.addAgent(newWallet);
        NOTE.setAgentRestrictions(newWallet, servicingRestrictions());
        PAYING_AGENT.revokeRole(PAYER_ROLE, old);
        PAYING_AGENT.grantRole(PAYER_ROLE, newWallet);
        servicingWallet = newWallet;
        emit ServicingWalletReplaced(old, newWallet);
    }

    function _replaceInstitution(address oldWallet, address newWallet) private {
        if (!isInstitution[oldWallet] || isInstitution[newWallet]) revert InvalidArgument();
        for (uint256 k = 0; k < _institutions.length; ++k) {
            if (_institutions[k] == oldWallet) _institutions[k] = newWallet;
        }
        isInstitution[oldWallet] = false;
        isInstitution[newWallet] = true;
        if (agentGovernance == oldWallet) agentGovernance = newWallet;
        emit InstitutionReplaced(oldWallet, newWallet);
    }

    function _onlyAgentGovernance() private view {
        if (msg.sender != agentGovernance) revert NotAgentGovernance(msg.sender);
    }

    function _venue() private view {
        if (address(CHECKER) == address(0)) revert NoVenue();
    }
}
