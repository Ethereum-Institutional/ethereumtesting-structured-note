// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IIdentity} from "@onchain-id/solidity/contracts/interface/IIdentity.sol";
import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {INote} from "../src/interfaces/INote.sol";
import {LockedSettlement} from "../src/LockedSettlement.sol";
import {ClaimTopics} from "../src/claims/ClaimTopics.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {DeterminationAgent} from "../src/DeterminationAgent.sol";
import {IProgrammeRoles} from "../src/interfaces/IProgrammeRoles.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Scaffolding} from "../script/Scaffolding.sol";
import {Issuance} from "../script/Issuance.sol";
import {Onboarding} from "../script/Onboarding.sol";
import {Programme} from "../script/Programme.sol";
import {MockWallet} from "./Mocks.sol";

interface IERC20Like {
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

/**
 * The deployment the tests run against, built by the same libraries as the deploy scripts: the
 * scaffolding, the programme (its controller and note factory), one note issued by the
 * Issuer's wallet into the controller's care, and its cast onboarded by role.
 *
 * The institutions' wallets are stand-ins. The Issuer's inventory is a holder like any other; the
 * controller mints into it. The servicing wallet opens and pays distributions, funded from the
 * Agent's deposit account. A client onboarded for the note carries both the bank's claim and the
 * onboarding agent's; one onboarded for cash only carries the bank's.
 */
abstract contract Stack is Test {
    Scaffolding.Deployed d;
    Programme.Deployed p;
    Issuance.Issued l;
    MockWallet agentGov;
    MockWallet issuerGov;
    MockWallet cosigner;
    MockWallet servicing;

    uint256 constant BANK_KEY = 0xBA4C;
    uint256 constant ONBOARDING_KEY = 0x0B0A;
    uint256 constant CA_KEY = 0xCA11;
    address bank = vm.addr(BANK_KEY);
    address onboardingAgent = vm.addr(ONBOARDING_KEY);
    address agent = makeAddr("Agent");
    address inventory = makeAddr("Issuer inventory");

    uint256 constant T0 = 1_790_000_000;
    uint256 constant Q = 90 days;
    /// @dev How long the claims the tests issue run.
    uint48 claimLife = 365 days;
    uint256[] initial;

    mapping(address wallet => IIdentity) identityOf;
    /// @dev The signature of each client's latest claim, by topic, for revocation.
    mapping(address wallet => mapping(uint256 topic => bytes)) claimOf;

    function _deployStack() internal {
        vm.warp(T0);
        _deployScaffolding();
        _deployProgramme(Programme.Venue(address(0), address(0), address(0)));
        initial = [uint256(451_200), 1_820_300, 25_000];
        l = _issueNote("N", _terms());
        _onboard(inventory, true);
        _onboard(agent, true);
        // The Agent's account funds distributions; the tests approve once, where operation
        // approves each distribution's amount as it opens.
        vm.prank(agent);
        IERC20Like(address(d.deposit)).approve(address(l.payingAgent), type(uint256).max);
    }

    function _deployScaffolding() internal {
        d = Scaffolding.deploy(Scaffolding.Config(address(this), bank, onboardingAgent, 3 * 365 days, "D", "D"));
        vm.startPrank(bank);
        Scaffolding.acceptByBank(d);
        vm.stopPrank();
    }

    /// The programme on the scaffolding: stand-in wallets for the institutions and the servicing
    /// wallet, the Calculation Agent's key, the Agent's account as funder.
    function _deployProgramme(Programme.Venue memory venue) internal {
        agentGov = new MockWallet(2);
        issuerGov = new MockWallet(2);
        cosigner = new MockWallet(2);
        servicing = new MockWallet(2);
        address[] memory institutions = new address[](3);
        (institutions[0], institutions[1], institutions[2]) = (address(agentGov), address(issuerGov), address(cosigner));
        p = Programme.deploy(
            d,
            Programme.Config({
                deployer: address(this),
                issuerWallet: address(issuerGov),
                institutions: institutions,
                agentGovernance: address(agentGov),
                servicingWallet: address(servicing),
                calculationAgent: vm.addr(CA_KEY),
                funder: agent,
                minInstitutions: 2,
                minSignatures: 4,
                tier2Delay: 1 hours,
                recoveryDelay: 4 hours,
                executionWindow: 1 days,
                venue: venue
            })
        );
    }

    /// Issues a note, as the Issuer's wallet does, into the controller's care.
    function _issueNote(string memory symbol, IDeterminationAgent.Terms memory terms)
        internal
        returns (Issuance.Issued memory issued)
    {
        vm.prank(address(issuerGov));
        issued = Issuance.issue(
            p.factory,
            terms,
            Issuance.Config({
                issuer: inventory,
                isin: "",
                name: symbol,
                symbol: symbol,
                termSheetHash: keccak256("term sheet"),
                termSheetUri: "ipfs://term-sheet",
                units: 0,
                open: false
            })
        );
    }

    // --- onboarding ---

    /// Onboards a wallet: an identity from the bank with the bank's claim, and for the note the
    /// onboarding agent's claim as well.
    function _onboard(address wallet, bool forNote) internal returns (IIdentity id) {
        vm.startPrank(bank);
        id = Onboarding.createIdentity(d, bank, wallet, vm.toString(wallet));
        Onboarding.consent(id, bank);
        if (forNote) Onboarding.consent(id, onboardingAgent);
        vm.stopPrank();
        identityOf[wallet] = id;
        _vouchCash(wallet);
        if (forNote) _vouchNote(wallet);
    }

    function _vouchCash(address wallet) internal {
        vm.startPrank(bank);
        claimOf[wallet][ClaimTopics.DEPOSIT_ELIGIBLE] = Onboarding.vouch(
            d.bankIssuer, BANK_KEY, identityOf[wallet], ClaimTopics.DEPOSIT_ELIGIBLE, uint48(block.timestamp) + claimLife, keccak256(abi.encode(wallet, "bank record"))
        );
        vm.stopPrank();
    }

    function _vouchNote(address wallet) internal {
        vm.startPrank(onboardingAgent);
        claimOf[wallet][ClaimTopics.NOTE_ELIGIBLE] = Onboarding.vouch(
            d.onboardingIssuer, ONBOARDING_KEY, identityOf[wallet], ClaimTopics.NOTE_ELIGIBLE, uint48(block.timestamp) + claimLife, keccak256(abi.encode(wallet, "onboarding record"))
        );
        vm.stopPrank();
    }

    function _revokeCash(address wallet) internal {
        vm.prank(bank);
        d.bankIssuer.revokeClaimBySignature(claimOf[wallet][ClaimTopics.DEPOSIT_ELIGIBLE]);
    }

    function _revokeNote(address wallet) internal {
        vm.prank(onboardingAgent);
        d.onboardingIssuer.revokeClaimBySignature(claimOf[wallet][ClaimTopics.NOTE_ELIGIBLE]);
    }

    // --- cash and units ---

    function _credit(address wallet, uint256 cents) internal {
        vm.prank(bank);
        d.gateway.credit(wallet, cents, keccak256(abi.encode(wallet, cents, block.timestamp, gasleft())));
    }

    /// Adds an agent with every power, as the note's owner does: the controller.
    function _addAgent(address who) internal {
        vm.prank(address(p.controller));
        l.note.addAgent(who);
    }

    /// Mints into the inventory and opens the note for transfers, as issuance does; the controller
    /// is the note's minting agent.
    function _issueUnits(uint256 units) internal {
        vm.startPrank(address(p.controller));
        l.note.mint(inventory, units);
        if (l.note.paused()) l.note.unpause();
        vm.stopPrank();
    }

    /// A Determination Agent on the given terms, cloned and initialised as the factory does.
    function _newDeterminations(IDeterminationAgent.Terms memory t) internal returns (DeterminationAgent da) {
        da = DeterminationAgent(Clones.clone(d.implementations.determinations));
        da.initialize(t, IProgrammeRoles(address(p.controller)));
    }

    // --- distributions, as the servicing wallet makes them ---

    function _openDistribution(uint256 dateIndex, PayingAgent.Kind kind) internal returns (bytes32) {
        vm.prank(address(servicing));
        return l.payingAgent.open(dateIndex, kind);
    }

    function _payHolders(bytes32 id, address[] memory holders) internal {
        vm.prank(address(servicing));
        l.payingAgent.pay(id, holders);
    }

    /// Placement: the inventory offers to sell to `to` at par, and `to` accepts.
    function _place(address to, uint64 units) internal {
        vm.prank(inventory);
        IERC20Like(address(l.note)).approve(address(l.settlement), units);
        vm.prank(inventory);
        uint256 id = l.settlement.offer(LockedSettlement.Side.Sell, to, units, uint256(units) * 100_000, uint48(block.timestamp + 1 days));
        vm.prank(to);
        IERC20Like(address(d.deposit)).approve(address(l.settlement), uint256(units) * 100_000);
        vm.prank(to);
        l.settlement.accept(id);
    }

    function _send(address from, address to, uint256 units) internal {
        vm.prank(from);
        IERC20Like(address(l.note)).transfer(to, units);
    }

    // --- terms and determinations ---

    /// Quarterly: three coupon and MER dates at a 100% trigger, then the final date.
    function _terms() internal view returns (IDeterminationAgent.Terms memory t) {
        t.initialLevels = initial;
        t.calculationAmountCents = 100_000;
        t.couponBarrierBps = 7_000;
        t.couponRateBps = 250;
        t.barrierBps = 6_000;
        t.schedule = new IDeterminationAgent.Observation[](4);
        for (uint256 k = 0; k < 4; ++k) {
            uint48 date = uint48(T0 + (k + 1) * Q);
            t.schedule[k] = IDeterminationAgent.Observation(
                date, date + 2 days, date + 5 days, true, k < 3, k == 3, k == 3, k < 3 ? 10_000 : 0
            );
        }
    }

    /// All three underlyings at `bps` of their Initial Levels.
    function _levels(uint256 bps) internal view returns (uint256[] memory lv) {
        lv = new uint256[](3);
        for (uint256 k = 0; k < 3; ++k) lv[k] = initial[k] * bps / 10_000;
    }

    function _determine(uint256 k, uint256 bps) internal returns (IDeterminationAgent.Outcome memory o) {
        uint256[] memory lv = _levels(bps);
        (o,) = l.determinations.compute(k, lv);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CA_KEY, l.determinations.digest(k, lv, o));
        l.determinations.determine(k, lv, o, abi.encodePacked(r, s, v));
    }

    function _obs(uint256 k) internal view returns (IDeterminationAgent.Observation memory) {
        return l.determinations.observation(k);
    }
}
