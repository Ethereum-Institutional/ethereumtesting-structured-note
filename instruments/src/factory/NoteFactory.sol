// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ITREXFactory} from "t-rex/factory/ITREXFactory.sol";
import {IIdentity} from "@onchain-id/solidity/contracts/interface/IIdentity.sol";
import {KeyPurposes} from "@onchain-id/solidity/contracts/libraries/KeyPurposes.sol";
import {KeyTypes} from "@onchain-id/solidity/contracts/libraries/KeyTypes.sol";

import {IDeterminationAgent} from "../interfaces/IDeterminationAgent.sol";
import {INote, AgentRestrictions, IOwnable2Step} from "../interfaces/INote.sol";
import {ClaimTopics} from "../claims/ClaimTopics.sol";
import {AgentPowers} from "./AgentPowers.sol";
import {TermsDeployer} from "./TermsDeployer.sol";
import {ServicingDeployer} from "./ServicingDeployer.sol";

/// @dev T-REX's identity registry, as far as the factory reads the note's suite from it.
interface ISuiteRegistry {
    function issuersRegistry() external view returns (address);
    function topicsRegistry() external view returns (address);
}

interface ITokenIdentity {
    function onchainID() external view returns (address);
}

/**
 * @title NoteFactory
 * @notice Issues a note on the shared scaffolding in one transaction (ADR 0091): its terms, its
 *         record dates, its T-REX suite, its term sheet, its Paying Agent and settlement contract,
 *         each agent restricted to its own powers, the notional minted to the Issuer's inventory,
 *         and the note opened for transfers.
 *
 * - **The Issuer alone issues.** The factory has one owner, the Issuer, and is the owner of
 *   T-REX's factory, so no note is issued around it.
 * - **The factory owns each note for the Issuer.** It owns the note's token, identity registry,
 *   trusted issuers, claim topics and compliance, and manages the note's identity, from issuance
 *   until the Issuer hands the note over. Meanwhile the Issuer administers a note through
 *   {administer}, which reaches that note's own contracts and nothing else.
 * - **One hand-over.** {handOver} offers every one of the note's contracts to a new owner, who
 *   accepts them (two-step, as T-REX's contracts are), and moves the identity's management to it.
 * - **No standing power.** The factory is an agent of a note only within {issue}, to mint and open
 *   it, and removes itself before it returns.
 * - **A record of every note.** Each note's contracts are kept, and emitted, for the Ledger and
 *   for reconciliation.
 *
 * The scaffolding it issues on is fixed at construction: T-REX's factory, the identity storage,
 * the deposit each note settles in, the onboarding agent's claim issuer whose note claim each
 * note's registry requires, and the onboarding agent as each registry's agent.
 */
contract NoteFactory is Ownable2Step {
    /// @notice An agent added at issuance beyond the Issuer and the lifecycle, with its powers.
    struct AgentGrant {
        address agent;
        AgentRestrictions restrictions;
    }

    struct Params {
        /// @dev Unique to the note within T-REX's factory.
        string salt;
        string name;
        string symbol;
        IDeterminationAgent.Terms terms;
        /// @dev The Issuer's inventory, and the note's minting agent.
        address issuer;
        address calculationAgent;
        /// @dev Whose deposit funds distributions: the Agent.
        address funder;
        /// @dev Who pays: the Agent's servicing wallet.
        address payer;
        bytes32 termSheetHash;
        string termSheetUri;
        /// @dev Minted to the Issuer's inventory at issuance; zero mints nothing.
        uint256 units;
        /// @dev Whether to open the note for transfers; T-REX issues it paused.
        bool open;
        AgentGrant[] agents;
    }

    /// @notice A note's contracts.
    struct Note {
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
    }

    ITREXFactory public immutable TREX_FACTORY;
    address public immutable IDENTITY_STORAGE;
    address public immutable DEPOSIT;
    address public immutable NOTE_CLAIM_ISSUER;
    address public immutable ONBOARDING_AGENT;
    TermsDeployer public immutable TERMS;
    ServicingDeployer public immutable SERVICING;

    address[] private _notes;
    mapping(address token => Note) private _noteOf;
    /// @notice Whether the factory still owns a note it issued, for the Issuer.
    mapping(address token => bool) public holds;

    event NoteIssued(address indexed token, string salt, Note note);
    event Administered(address indexed token, address indexed target, bytes4 selector);
    event HandedOver(address indexed token, address indexed newOwner);

    error InvalidArgument();
    error NotHeld(address token);
    error NotPartOfNote(address target);

    struct Scaffold {
        address trexFactory;
        address identityStorage;
        address deposit;
        address noteClaimIssuer;
        address onboardingAgent;
        TermsDeployer terms;
        ServicingDeployer servicing;
    }

    constructor(address issuer, Scaffold memory s) Ownable(issuer) {
        TREX_FACTORY = ITREXFactory(s.trexFactory);
        IDENTITY_STORAGE = s.identityStorage;
        DEPOSIT = s.deposit;
        NOTE_CLAIM_ISSUER = s.noteClaimIssuer;
        ONBOARDING_AGENT = s.onboardingAgent;
        TERMS = s.terms;
        SERVICING = s.servicing;
    }

    // ------------------------------------------------------------------------------------------
    // Issuance
    // ------------------------------------------------------------------------------------------

    /// @notice Issues a note, whole, in this one transaction.
    function issue(Params calldata p) external onlyOwner returns (Note memory n) {
        if (p.issuer == address(0) || p.calculationAgent == address(0) || p.funder == address(0) || p.payer == address(0)) {
            revert InvalidArgument();
        }
        (n.determinations, n.recordDates) = _terms(p);
        _suite(p, n);
        _termSheet(n.identity, p);
        _servicing(p, n);
        _agents(p, n);

        INote note = INote(n.token);
        if (p.units > 0) note.mint(p.issuer, p.units);
        if (p.open) note.unpause();
        note.removeAgent(address(this));

        _notes.push(n.token);
        _noteOf[n.token] = n;
        holds[n.token] = true;
        emit NoteIssued(n.token, p.salt, n);
    }

    // ------------------------------------------------------------------------------------------
    // The Issuer's administration, until it hands a note over
    // ------------------------------------------------------------------------------------------

    /**
     * @notice Calls one of a held note's own contracts as its owner: the token, its identity
     *         registry, trusted issuers, claim topics, compliance, or identity. A refusal is passed
     *         back whole.
     */
    function administer(address token, address target, bytes calldata data) external onlyOwner returns (bytes memory) {
        if (!holds[token]) revert NotHeld(token);
        if (!_isPartOf(_noteOf[token], target)) revert NotPartOfNote(target);
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
        emit Administered(token, target, bytes4(data));
        return ret;
    }

    /**
     * @notice Offers every one of a held note's contracts to `newOwner`, which accepts each, and
     *         makes it the manager of the note's identity in the factory's place.
     */
    function handOver(address token, address newOwner) external onlyOwner {
        if (!holds[token]) revert NotHeld(token);
        if (newOwner == address(0) || newOwner == address(this)) revert InvalidArgument();
        Note storage n = _noteOf[token];
        IOwnable2Step(n.token).transferOwnership(newOwner);
        IOwnable2Step(n.identityRegistry).transferOwnership(newOwner);
        IOwnable2Step(n.trustedIssuers).transferOwnership(newOwner);
        IOwnable2Step(n.claimTopics).transferOwnership(newOwner);
        IOwnable2Step(n.compliance).transferOwnership(newOwner);
        IIdentity identity = IIdentity(n.identity);
        identity.addKey(keccak256(abi.encode(newOwner)), KeyPurposes.MANAGEMENT, KeyTypes.ECDSA);
        identity.removeKey(keccak256(abi.encode(address(this))), KeyPurposes.MANAGEMENT);
        holds[token] = false;
        emit HandedOver(token, newOwner);
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

    /// The note's terms, fixed in its Determination Agent, and its record-date module.
    function _terms(Params calldata p) private returns (address determinations, address recordDates) {
        return _call2(address(TERMS), abi.encodeCall(TermsDeployer.deploy, (p.terms, p.calculationAgent)));
    }

    /// The token, its identity, registry and compliance, as one T-REX suite owned by the factory.
    function _suite(Params calldata p, Note memory n) private {
        address[] memory irAgents = new address[](1);
        irAgents[0] = ONBOARDING_AGENT;
        address[] memory tokenAgents = new address[](1);
        tokenAgents[0] = address(this);
        address[] memory modules = new address[](1);
        modules[0] = n.recordDates;
        uint256[] memory topics = new uint256[](1);
        topics[0] = ClaimTopics.NOTE_ELIGIBLE;
        address[] memory issuers = new address[](1);
        issuers[0] = NOTE_CLAIM_ISSUER;
        uint256[][] memory issuerTopics = new uint256[][](1);
        issuerTopics[0] = topics;

        TREX_FACTORY.deployTREXSuite(
            p.salt,
            ITREXFactory.TokenDetails({
                owner: address(this),
                name: p.name,
                symbol: p.symbol,
                decimals: 0,
                irs: IDENTITY_STORAGE,
                ONCHAINID: address(0),
                irAgents: irAgents,
                tokenAgents: tokenAgents,
                complianceModules: modules,
                complianceSettings: new bytes[](0)
            }),
            ITREXFactory.ClaimDetails({claimTopics: topics, issuers: issuers, issuerClaims: issuerTopics})
        );
        n.token = TREX_FACTORY.getToken(p.salt);
        INote note = INote(n.token);
        n.identity = ITokenIdentity(n.token).onchainID();
        n.identityRegistry = note.identityRegistry();
        n.compliance = note.compliance();
        n.trustedIssuers = ISuiteRegistry(n.identityRegistry).issuersRegistry();
        n.claimTopics = ISuiteRegistry(n.identityRegistry).topicsRegistry();
    }

    /// The note's owner states its term sheet on the note's identity: its hash and where it is.
    function _termSheet(address identity, Params calldata p) private {
        IIdentity(identity).addClaim(
            ClaimTopics.TERM_SHEET, 1, identity, "", abi.encode(p.termSheetHash, p.termSheetUri), p.termSheetUri
        );
    }

    function _servicing(Params calldata p, Note memory n) private {
        ServicingDeployer.Servicing memory s = ServicingDeployer.Servicing({
            note: n.token,
            cash: DEPOSIT,
            determinations: n.determinations,
            recordDates: n.recordDates,
            inventory: p.issuer,
            funder: p.funder,
            admin: owner(),
            payer: p.payer
        });
        (n.payingAgent, n.settlement) = _call2(address(SERVICING), abi.encodeCall(ServicingDeployer.deploy, (s)));
    }

    function _agents(Params calldata p, Note memory n) private {
        INote note = INote(n.token);
        _grant(note, p.issuer, AgentPowers.issuer());
        _grant(note, n.payingAgent, AgentPowers.payingAgent());
        _grant(note, n.settlement, AgentPowers.settlement());
        for (uint256 k = 0; k < p.agents.length; ++k) {
            if (p.agents[k].agent == address(0) || p.agents[k].agent == address(this)) revert InvalidArgument();
            _grant(note, p.agents[k].agent, p.agents[k].restrictions);
        }
    }

    function _grant(INote note, address agent, AgentRestrictions memory restrictions) private {
        if (!note.isAgent(agent)) note.addAgent(agent);
        note.setAgentRestrictions(agent, restrictions);
    }

    function _isPartOf(Note storage n, address target) private view returns (bool) {
        return target != address(0)
            && (target == n.token || target == n.identityRegistry || target == n.trustedIssuers || target == n.claimTopics
                || target == n.compliance || target == n.identity);
    }

    /// @dev Calls a deployer, which returns two addresses, keeping its contracts' code out of this
    ///      contract's own.
    function _call2(address deployer, bytes memory data) private returns (address a, address b) {
        (bool ok, bytes memory ret) = deployer.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
        (a, b) = abi.decode(ret, (address, address));
    }
}
