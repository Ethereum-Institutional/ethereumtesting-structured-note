// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

interface IThresholdWallet {
    function getThreshold() external view returns (uint256);
}

interface IGovernedToken {
    function forcedTransfer(address from, address to, uint256 value, bytes calldata data) external returns (bool);
    function mint(address account, uint256 value) external;
    function burn(address account, uint256 value) external;
    function setRuleEngine(address ruleEngine) external;
    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable;
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
}

interface IGovernedRegistry {
    function withdraw(address account, string calldata reason) external;
    function setRegistrar(address issuingKey, uint16 registrar) external;
    function setMaxValidity(uint40 maxValidity) external;
}

interface IGovernedPayingAgent {
    function INVENTORY() external view returns (address);
    function reverse(bytes32 id, address[] calldata holders, string calldata reason) external;
    function restate(bytes32 original, uint48 recordTime, string calldata reason) external returns (bytes32);
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
}

/**
 * @title GovernanceController
 * @notice Every privileged power over the note, the deposit, the registry and the Paying Agent,
 *         exercised in two tiers through a fixed set of typed acts, and nothing else.
 *
 * - **No general call path** (section 7, ADR 0021). Each permitted act is its own entry point
 *   with typed arguments; a proposal stores those arguments, never calldata, and the controller
 *   builds every downstream call itself. This source is the complete permitted set.
 * - **Tier 1, register correction** (overview; ADR 0025). The Agent's governance wallet alone,
 *   with no delay: correcting the note's register by a reason-carrying forced transfer, and
 *   supervisory withdrawal of a grant (ADR 0004). Each carries its written reason in full.
 * - **Tier 2, intervention.** Proposed and approved by the institution wallets. It is queued once
 *   approvals come from at least `MIN_INSTITUTIONS` institutions whose wallets' own thresholds sum
 *   to at least `MIN_SIGNATURES` (ADR 0022), and can be executed after `TIER2_DELAY` (ADR 0023).
 *   Thresholds are checked again at execution. The reason is stored and emitted in full, because a
 *   notice that needs an off-chain lookup is not notice.
 * - **Recovery** (ADR 0019). Replacing an institution's wallet needs every other institution and
 *   the longer `RECOVERY_DELAY`, and the wallet being replaced can cancel it if it still works.
 * - **Nothing is upgradeable,** and no act changes the thresholds or the delays.
 */
contract GovernanceController {
    enum Kind {
        Upgrade,
        ReplaceGate,
        AmendNotional,
        ReverseDistribution,
        RestateDistribution,
        SetRegistrar,
        SetMaxValidity,
        ReplaceServicingWallet,
        ReplaceInstitution
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

    // Roles on the governed contracts, by name, for the typed role changes below.
    bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 private constant ENFORCER_ROLE = keccak256("ENFORCER_ROLE");
    bytes32 private constant ERC20ENFORCER_ROLE = keccak256("ERC20ENFORCER_ROLE");
    bytes32 private constant DOCUMENT_ROLE = keccak256("DOCUMENT_ROLE");
    bytes32 private constant PAYER_ROLE = keccak256("PAYER_ROLE");

    IGovernedToken public immutable NOTE;
    IGovernedToken public immutable DEPOSIT;
    IGovernedRegistry public immutable REGISTRY;
    IGovernedPayingAgent public immutable PAYING_AGENT;

    uint256 public immutable MIN_INSTITUTIONS;
    uint256 public immutable MIN_SIGNATURES;
    uint48 public immutable TIER2_DELAY;
    uint48 public immutable RECOVERY_DELAY;

    address[] private _institutions;
    mapping(address wallet => bool) public isInstitution;
    /// @notice The Agent's governance wallet: an institution, and the only Tier 1 actor.
    address public agentGovernance;
    /// @notice The Agent's servicing wallet (ADR 0025), replaceable only by Tier 2.
    address public servicingWallet;

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
    error NotGoverned(address token);
    error InvalidArgument();

    struct Config {
        address note;
        address deposit;
        address registry;
        address payingAgent;
        address[] institutions;
        address agentGovernance;
        address servicingWallet;
        uint256 minInstitutions;
        uint256 minSignatures;
        uint48 tier2Delay;
        uint48 recoveryDelay;
    }

    constructor(Config memory c) {
        if (c.tier2Delay == 0) revert InvalidConfiguration("Tier 2 delay is zero");
        if (c.recoveryDelay <= c.tier2Delay) revert InvalidConfiguration("recovery delay not longer than Tier 2");
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
        NOTE = IGovernedToken(c.note);
        DEPOSIT = IGovernedToken(c.deposit);
        REGISTRY = IGovernedRegistry(c.registry);
        PAYING_AGENT = IGovernedPayingAgent(c.payingAgent);
        MIN_INSTITUTIONS = c.minInstitutions;
        MIN_SIGNATURES = c.minSignatures;
        TIER2_DELAY = c.tier2Delay;
        RECOVERY_DELAY = c.recoveryDelay;
        agentGovernance = c.agentGovernance;
        servicingWallet = c.servicingWallet;
    }

    modifier withReason(string calldata reason) {
        if (bytes(reason).length == 0) revert NoReason();
        _;
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
        NOTE.forcedTransfer(from, to, units, bytes(reason));
        emit Tier1("correctRegister", reason);
    }

    /// @notice Withdraws any grant at once, whichever registrar wrote it (Tier 1, ADR 0004).
    function withdrawGrant(address account, string calldata reason) external withReason(reason) {
        _onlyAgentGovernance();
        REGISTRY.withdraw(account, reason);
        emit Tier1("withdrawGrant", reason);
    }

    // ------------------------------------------------------------------------------------------
    // Tier 2: proposals, one typed entry point per permitted act
    // ------------------------------------------------------------------------------------------

    /// @notice Upgrades the note or the deposit to a new implementation.
    function proposeUpgrade(address token, address implementation, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        _governed(token);
        if (implementation == address(0)) revert InvalidArgument();
        return _propose(Kind.Upgrade, abi.encode(token, implementation), reason);
    }

    /// @notice Points the note or the deposit at a new gate.
    function proposeReplaceGate(address token, address gate, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        _governed(token);
        if (gate == address(0)) revert InvalidArgument();
        return _propose(Kind.ReplaceGate, abi.encode(token, gate), reason);
    }

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

    /// @notice Appoints or removes a registrar's issuing key.
    function proposeSetRegistrar(address issuingKey, uint16 registrar, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        if (issuingKey == address(0)) revert InvalidArgument();
        return _propose(Kind.SetRegistrar, abi.encode(issuingKey, registrar), reason);
    }

    /// @notice Sets the longest a grant may run.
    function proposeSetMaxValidity(uint40 maxValidity, string calldata reason)
        external
        withReason(reason)
        returns (uint256)
    {
        if (maxValidity == 0) revert InvalidArgument();
        return _propose(Kind.SetMaxValidity, abi.encode(maxValidity), reason);
    }

    /// @notice Moves every servicing role from the servicing wallet to a new one, as one act.
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
        if (k == Kind.Upgrade) {
            (address token, address impl) = abi.decode(p.args, (address, address));
            IGovernedToken(token).upgradeToAndCall(impl, "");
        } else if (k == Kind.ReplaceGate) {
            (address token, address gate) = abi.decode(p.args, (address, address));
            IGovernedToken(token).setRuleEngine(gate);
        } else if (k == Kind.AmendNotional) {
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
        } else if (k == Kind.SetRegistrar) {
            (address key, uint16 registrar) = abi.decode(p.args, (address, uint16));
            REGISTRY.setRegistrar(key, registrar);
        } else if (k == Kind.SetMaxValidity) {
            REGISTRY.setMaxValidity(abi.decode(p.args, (uint40)));
        } else if (k == Kind.ReplaceServicingWallet) {
            _replaceServicing(abi.decode(p.args, (address)));
        } else {
            (address oldWallet, address newWallet) = abi.decode(p.args, (address, address));
            _replaceInstitution(oldWallet, newWallet);
        }
    }

    /// @dev The servicing roles of ADR 0025, moved together.
    function _replaceServicing(address newWallet) private {
        address old = servicingWallet;
        bytes32[4] memory noteRoles = [PAUSER_ROLE, ENFORCER_ROLE, ERC20ENFORCER_ROLE, DOCUMENT_ROLE];
        for (uint256 k = 0; k < noteRoles.length; ++k) {
            NOTE.revokeRole(noteRoles[k], old);
            NOTE.grantRole(noteRoles[k], newWallet);
        }
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

    function _governed(address token) private view {
        if (token != address(NOTE) && token != address(DEPOSIT)) revert NotGoverned(token);
    }
}
