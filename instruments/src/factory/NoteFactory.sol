// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ITREXFactory} from "t-rex/factory/ITREXFactory.sol";
import {IIdentity} from "@onchain-id/solidity/contracts/interface/IIdentity.sol";
import {KeyPurposes} from "@onchain-id/solidity/contracts/libraries/KeyPurposes.sol";
import {KeyTypes} from "@onchain-id/solidity/contracts/libraries/KeyTypes.sol";

import {IDeterminationAgent} from "../interfaces/IDeterminationAgent.sol";
import {IProgrammeRoles} from "../interfaces/IProgrammeRoles.sol";
import {INote, AgentRestrictions, IOwnable2Step} from "../interfaces/INote.sol";
import {ClaimTopics} from "../claims/ClaimTopics.sol";
import {DeterminationAgent} from "../DeterminationAgent.sol";
import {RecordDateModule} from "../compliance/RecordDateModule.sol";
import {PayingAgent, INoteServicing, ICashLeg, IRecordDates} from "../PayingAgent.sol";
import {LockedSettlement, ICashLeg as ISettlementCash} from "../LockedSettlement.sol";
import {AgentPowers} from "./AgentPowers.sol";
import {ProgrammeTREXFactory} from "./ProgrammeTREXFactory.sol";

/// @dev T-REX's identity registry, as far as the factory reads the note's suite from it.
interface ISuiteRegistry {
    function issuersRegistry() external view returns (address);
    function topicsRegistry() external view returns (address);
}

interface ITokenIdentity {
    function onchainID() external view returns (address);
}

/// @dev The deposit, as far as the factory allowlists a note's lifecycle contracts on it.
interface IAllowlist {
    function setAllowlistedMany(address[] calldata accounts, bool allowed) external;
}

/// @dev The governance controller takes each note into its care at issuance.
interface IAdopts {
    function adopt(NoteFactory.Note calldata n) external;
}

/**
 * @title NoteFactory
 * @notice Issues the programme's notes (ADR 0115). Each note is issued whole, in one transaction,
 *         straight into the governance controller's care; several may be issued in one call.
 *
 * - **The Issuer alone issues.** The factory's owner is the Issuer's multi-signature wallet, and
 *   the factory owns T-REX's factory, so no note is issued around it.
 * - **A series identity.** Each note takes the next series number, its salt, and optionally an
 *   ISIN; both are stated on the note's identity and kept in the record.
 * - **Its own lifecycle contracts, as clones.** The note's Determination Agent, record-date module,
 *   Paying Agent and settlement contract are minimal clones of fixed implementations, so each note
 *   stays isolated from every other while issuance stays cheap.
 * - **The programme's checks.** Every note requires the onboarding agent's note claim, plus any
 *   further claims its series names, and carries the programme's sanctions module.
 * - **Governed from the first block.** The note's contracts are handed to the governance
 *   controller, which accepts them in the same transaction; the factory keeps no power over a note
 *   once issued. The Issuer keeps none either: its inventory is a holder like any other.
 * - **Allowlisted at once.** The note's Paying Agent and settlement contract are allowlisted on the
 *   deposit in the same transaction, the bank having granted the factory that role.
 * - **The shared identity storage, stewarded.** On the controller's act, the factory unbinds a
 *   redeemed note's registry from the storage, which binds at most 300, and can hand T-REX's
 *   factory, and with it the storage, to a successor.
 */
contract NoteFactory is Ownable2Step {
    struct Params {
        /// @dev The note's ISIN, twelve characters, or empty where it has none.
        string isin;
        string name;
        string symbol;
        IDeterminationAgent.Terms terms;
        /// @dev The Issuer's inventory, which the notional is minted to.
        address issuer;
        bytes32 termSheetHash;
        string termSheetUri;
        /// @dev Minted to the Issuer's inventory at issuance; zero mints nothing.
        uint256 units;
        /// @dev Whether to open the note for transfers; T-REX issues it paused.
        bool open;
        /// @dev Claims this series requires beyond the note claim, each with the issuer trusted for it.
        uint256[] extraTopics;
        address[] extraIssuers;
    }

    /// @notice A note's contracts, and its place in the programme.
    struct Note {
        uint256 series;
        address token;
        address identity;
        address identityRegistry;
        address compliance;
        address trustedIssuers;
        address claimTopics;
        address determinations;
        address recordDates;
        address payingAgent;
        address settlement;
        address inventory;
    }

    /// @notice The implementations each note's lifecycle contracts are cloned from.
    struct Implementations {
        address determinations;
        address recordDates;
        address payingAgent;
        address settlement;
    }

    struct Scaffold {
        address trexFactory;
        address identityStorage;
        address deposit;
        address noteClaimIssuer;
        address sanctions;
        address governance;
        Implementations implementations;
    }

    ProgrammeTREXFactory public immutable TREX_FACTORY;
    address public immutable IDENTITY_STORAGE;
    address public immutable DEPOSIT;
    address public immutable NOTE_CLAIM_ISSUER;
    address public immutable SANCTIONS;
    /// @notice The governance controller: every note's owner, and the programme's roles.
    address public immutable GOVERNANCE;
    address public immutable DETERMINATIONS_IMPL;
    address public immutable RECORD_DATES_IMPL;
    address public immutable PAYING_AGENT_IMPL;
    address public immutable SETTLEMENT_IMPL;

    uint256 public seriesCount;
    address[] private _notes;
    mapping(address token => Note) private _noteOf;
    mapping(uint256 series => address token) public tokenOfSeries;
    /// @notice Whether a redeemed note's registry has been unbound from the shared storage.
    mapping(address token => bool) public retired;

    event NoteIssued(address indexed token, uint256 indexed series, string isin, Note note);
    event Retired(address indexed token);
    event TrexFactoryReleased(address indexed successor);

    error InvalidArgument();
    error NotGovernance(address caller);
    error UnknownNote(address token);
    error NotRedeemed(address token);

    constructor(address issuerWallet, Scaffold memory s) Ownable(issuerWallet) {
        TREX_FACTORY = ProgrammeTREXFactory(s.trexFactory);
        IDENTITY_STORAGE = s.identityStorage;
        DEPOSIT = s.deposit;
        NOTE_CLAIM_ISSUER = s.noteClaimIssuer;
        SANCTIONS = s.sanctions;
        GOVERNANCE = s.governance;
        DETERMINATIONS_IMPL = s.implementations.determinations;
        RECORD_DATES_IMPL = s.implementations.recordDates;
        PAYING_AGENT_IMPL = s.implementations.payingAgent;
        SETTLEMENT_IMPL = s.implementations.settlement;
    }

    // ------------------------------------------------------------------------------------------
    // Issuance
    // ------------------------------------------------------------------------------------------

    /// @notice Issues a note, whole, in this one transaction, into the controller's care.
    function issue(Params calldata p) external onlyOwner returns (Note memory) {
        return _issue(p);
    }

    /// @notice Issues several notes in one transaction.
    function issueMany(Params[] calldata ps) external onlyOwner returns (Note[] memory out) {
        out = new Note[](ps.length);
        for (uint256 k = 0; k < ps.length; ++k) {
            out[k] = _issue(ps[k]);
        }
    }

    // ------------------------------------------------------------------------------------------
    // Stewardship of the shared identity storage, on the controller's act
    // ------------------------------------------------------------------------------------------

    /// @notice Unbinds a redeemed note's registry from the shared identity storage.
    function retire(address token) external {
        _onlyGovernance();
        Note storage n = _noteOf[token];
        if (n.token == address(0)) revert UnknownNote(token);
        if (!IDeterminationAgent(n.determinations).terminated() || INote(token).totalSupply() != 0) revert NotRedeemed(token);
        retired[token] = true;
        TREX_FACTORY.unbindIdentityRegistry(IDENTITY_STORAGE, n.identityRegistry);
        emit Retired(token);
    }

    /// @notice Hands T-REX's factory, and with it the shared identity storage, to a successor
    ///         factory, so the programme's identities carry over.
    function releaseTrexFactory(address successor) external {
        _onlyGovernance();
        if (successor == address(0)) revert InvalidArgument();
        TREX_FACTORY.transferOwnership(successor);
        emit TrexFactoryReleased(successor);
    }

    // ------------------------------------------------------------------------------------------
    // The record
    // ------------------------------------------------------------------------------------------

    function noteOf(address token) external view returns (Note memory) {
        return _noteOf[token];
    }

    function notes() external view returns (address[] memory) {
        return _notes;
    }

    function noteCount() external view returns (uint256) {
        return _notes.length;
    }

    // ------------------------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------------------------

    function _issue(Params calldata p) private returns (Note memory n) {
        if (p.issuer == address(0)) revert InvalidArgument();
        if (bytes(p.isin).length != 0 && bytes(p.isin).length != 12) revert InvalidArgument();
        if (p.extraTopics.length != p.extraIssuers.length || p.extraTopics.length > 4) revert InvalidArgument();
        n.series = ++seriesCount;
        n.inventory = p.issuer;
        string memory salt = string.concat("series-", Strings.toString(n.series));

        _terms(p, n);
        _suite(p, n, salt);
        _statements(p, n);
        _servicing(p, n);
        _agents(n);

        INote note = INote(n.token);
        if (p.units > 0) note.mint(p.issuer, p.units);
        if (p.open) note.unpause();
        note.removeAgent(address(this));

        address[] memory lifecycle = new address[](2);
        (lifecycle[0], lifecycle[1]) = (n.payingAgent, n.settlement);
        IAllowlist(DEPOSIT).setAllowlistedMany(lifecycle, true);

        _notes.push(n.token);
        _noteOf[n.token] = n;
        tokenOfSeries[n.series] = n.token;
        _handOver(n);
        emit NoteIssued(n.token, n.series, p.isin, n);
    }

    /// The note's terms, in a clone of the Determination Agent, and its record dates.
    function _terms(Params calldata p, Note memory n) private {
        n.determinations = Clones.clone(DETERMINATIONS_IMPL);
        DeterminationAgent(n.determinations).initialize(p.terms, IProgrammeRoles(GOVERNANCE));
        n.recordDates = Clones.clone(RECORD_DATES_IMPL);
        RecordDateModule(n.recordDates).initialize(IDeterminationAgent(n.determinations));
    }

    /// The token, its identity, registry and compliance, as one T-REX suite.
    function _suite(Params calldata p, Note memory n, string memory salt) private {
        uint256 extra = p.extraTopics.length;
        uint256[] memory topics = new uint256[](1 + extra);
        address[] memory issuers = new address[](1 + extra);
        uint256[][] memory issuerTopics = new uint256[][](1 + extra);
        topics[0] = ClaimTopics.NOTE_ELIGIBLE;
        issuers[0] = NOTE_CLAIM_ISSUER;
        issuerTopics[0] = new uint256[](1);
        issuerTopics[0][0] = ClaimTopics.NOTE_ELIGIBLE;
        for (uint256 k = 0; k < extra; ++k) {
            if (p.extraIssuers[k] == address(0) || p.extraIssuers[k] == NOTE_CLAIM_ISSUER) revert InvalidArgument();
            topics[1 + k] = p.extraTopics[k];
            issuers[1 + k] = p.extraIssuers[k];
            issuerTopics[1 + k] = new uint256[](1);
            issuerTopics[1 + k][0] = p.extraTopics[k];
        }
        address[] memory tokenAgents = new address[](1);
        tokenAgents[0] = address(this);
        address[] memory modules = new address[](2);
        (modules[0], modules[1]) = (n.recordDates, SANCTIONS);

        TREX_FACTORY.deployTREXSuite(
            salt,
            ITREXFactory.TokenDetails({
                owner: address(this),
                name: p.name,
                symbol: p.symbol,
                decimals: 0,
                irs: IDENTITY_STORAGE,
                ONCHAINID: address(0),
                irAgents: new address[](0),
                tokenAgents: tokenAgents,
                complianceModules: modules,
                complianceSettings: new bytes[](0)
            }),
            ITREXFactory.ClaimDetails({claimTopics: topics, issuers: issuers, issuerClaims: issuerTopics})
        );
        n.token = TREX_FACTORY.getToken(salt);
        INote note = INote(n.token);
        n.identity = ITokenIdentity(n.token).onchainID();
        n.identityRegistry = note.identityRegistry();
        n.compliance = note.compliance();
        n.trustedIssuers = ISuiteRegistry(n.identityRegistry).issuersRegistry();
        n.claimTopics = ISuiteRegistry(n.identityRegistry).topicsRegistry();
    }

    /// The note's owner states, on the note's identity, its term sheet and its series identity.
    function _statements(Params calldata p, Note memory n) private {
        IIdentity identity = IIdentity(n.identity);
        identity.addClaim(
            ClaimTopics.TERM_SHEET, 1, n.identity, "", abi.encode(p.termSheetHash, p.termSheetUri), p.termSheetUri
        );
        identity.addClaim(ClaimTopics.SERIES, 1, n.identity, "", abi.encode(n.series, p.isin), "");
    }

    /// The note's Paying Agent and settlement contract, as clones.
    function _servicing(Params calldata p, Note memory n) private {
        n.payingAgent = Clones.clone(PAYING_AGENT_IMPL);
        PayingAgent(n.payingAgent).initialize(
            INoteServicing(n.token),
            ICashLeg(DEPOSIT),
            IDeterminationAgent(n.determinations),
            IRecordDates(n.recordDates),
            p.issuer,
            IProgrammeRoles(GOVERNANCE)
        );
        n.settlement = Clones.clone(SETTLEMENT_IMPL);
        LockedSettlement(n.settlement).initialize(INote(n.token), ISettlementCash(DEPOSIT));
    }

    /// Each of the note's agents, restricted to its own powers.
    function _agents(Note memory n) private {
        INote note = INote(n.token);
        _grant(note, n.payingAgent, AgentPowers.payingAgent());
        _grant(note, n.settlement, AgentPowers.settlement());
        _grant(note, GOVERNANCE, AgentPowers.controller());
    }

    /// Every one of the note's contracts offered to the controller, which accepts them now; the
    /// note's identity managed by the controller in the factory's place.
    function _handOver(Note memory n) private {
        IOwnable2Step(n.token).transferOwnership(GOVERNANCE);
        IOwnable2Step(n.identityRegistry).transferOwnership(GOVERNANCE);
        IOwnable2Step(n.trustedIssuers).transferOwnership(GOVERNANCE);
        IOwnable2Step(n.claimTopics).transferOwnership(GOVERNANCE);
        IOwnable2Step(n.compliance).transferOwnership(GOVERNANCE);
        IIdentity identity = IIdentity(n.identity);
        identity.addKey(keccak256(abi.encode(GOVERNANCE)), KeyPurposes.MANAGEMENT, KeyTypes.ECDSA);
        identity.removeKey(keccak256(abi.encode(address(this))), KeyPurposes.MANAGEMENT);
        IAdopts(GOVERNANCE).adopt(n);
    }

    function _grant(INote note, address agent, AgentRestrictions memory restrictions) private {
        if (!note.isAgent(agent)) note.addAgent(agent);
        note.setAgentRestrictions(agent, restrictions);
    }

    function _onlyGovernance() private view {
        if (msg.sender != GOVERNANCE) revert NotGovernance(msg.sender);
    }
}
