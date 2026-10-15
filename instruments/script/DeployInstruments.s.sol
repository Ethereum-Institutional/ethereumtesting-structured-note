// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IIdentity} from "@onchain-id/solidity/contracts/interface/IIdentity.sol";
import {ClaimTopics} from "../src/claims/ClaimTopics.sol";
import {Scaffolding} from "./Scaffolding.sol";
import {Onboarding} from "./Onboarding.sol";

/**
 * Deploys the scaffolding, onboards the cast by role, and opens their deposit accounts (ADR 0088).
 *
 * Run from instruments/ after script/00_DeployBase.s.sol, whose manifest it extends, and before
 * the venue, which wraps the deposit. Onboarding here is each institution acting directly,
 * standing in for the verification that precedes a claim in operation:
 * - the bank (the Deposit Agent's key) creates every identity, records each client's consent, and
 *   vouches that the client may hold its deposit;
 * - the onboarding agent (the Access Issuer's key) vouches that the client may hold the note.
 *
 * Investor C is onboarded for the cash leg only, so it can hold the deposit but not the note.
 * Investor D is never onboarded. The Agent holds the deposit to fund distributions. The bank holds
 * the deposit as the pool's liquidity provider, allowlisted as its own account, and has an identity
 * so that the pool's gate can admit it. Custody accounts are onboarded when they are opened.
 */
contract DeployInstruments is Script {
    uint48 constant MAX_CLAIM_VALIDITY = 365 days;
    uint48 constant CLAIM_VALIDITY = 180 days;

    struct Keys {
        uint256 deployer;
        uint256 bank;
        uint256 onboarding;
    }

    function run() external {
        Keys memory k = Keys(vm.envUint("ISSUER_PK"), vm.envUint("DEPOSIT_AGENT_PK"), vm.envUint("ACCESS_ISSUER_PK"));
        string memory j = vm.readFile(_manifest());

        vm.startBroadcast(k.deployer);
        Scaffolding.Deployed memory d = Scaffolding.deploy(
            Scaffolding.Config({
                deployer: vm.addr(k.deployer),
                bank: vm.addr(k.bank),
                onboardingAgent: vm.addr(k.onboarding),
                maxClaimValidity: MAX_CLAIM_VALIDITY,
                // Local defaults. On any other chain each value must be set explicitly (ADR 0027).
                depositName: _param("DEPOSIT_NAME", "Euro Tokenized Deposit"),
                depositSymbol: _param("DEPOSIT_SYMBOL", "EURTD")
            })
        );
        vm.stopBroadcast();

        vm.startBroadcast(k.bank);
        Scaffolding.acceptByBank(d);
        d.deposit.setAllowlisted(vm.addr(k.bank), true);
        vm.stopBroadcast();

        address investorA = vm.parseJsonAddress(j, ".parties.investorA");
        address investorB = vm.parseJsonAddress(j, ".parties.investorB");
        address investorC = vm.parseJsonAddress(j, ".parties.investorC");
        _onboard(d, k, vm.addr(k.deployer), true);
        _onboard(d, k, investorA, true);
        _onboard(d, k, investorB, true);
        _onboard(d, k, investorC, false);
        _onboard(d, k, vm.addr(vm.envUint("AGENT_PK")), false);
        _onboardBank(d, k);

        // Opening balances on the cash leg, each against its own booking.
        vm.startBroadcast(k.bank);
        d.gateway.credit(investorA, 5_000_000_00, "opening/investorA");
        d.gateway.credit(investorB, 1_000_000_00, "opening/investorB");
        d.gateway.credit(investorC, 1_000_000_00, "opening/investorC");
        vm.stopBroadcast();

        console2.log("identity storage :", address(d.identities));
        console2.log("T-REX factory    :", address(d.trexFactory));
        console2.log("deposit          :", address(d.deposit));
        console2.log("gateway          :", address(d.gateway));
        _record(d, vm.addr(k.onboarding), vm.addr(k.bank));
    }

    /// The bank creates the identity, records the client's consent and vouches for the deposit; for
    /// the note, the onboarding agent vouches too. The bank admits clients to the pool where the pool
    /// is deployed (script/02_ActivateVenue.s.sol).
    function _onboard(Scaffolding.Deployed memory d, Keys memory k, address wallet, bool forNote) private {
        address bank = vm.addr(k.bank);
        uint48 until = uint48(block.timestamp) + CLAIM_VALIDITY;
        vm.startBroadcast(k.bank);
        IIdentity id = Onboarding.createIdentity(d, bank, wallet, vm.toString(wallet));
        Onboarding.consent(id, bank);
        if (forNote) Onboarding.consent(id, vm.addr(k.onboarding));
        Onboarding.vouch(d.bankIssuer, k.bank, id, ClaimTopics.DEPOSIT_ELIGIBLE, until, _recordHash(wallet, "bank"));
        vm.stopBroadcast();
        if (!forNote) return;
        vm.startBroadcast(k.onboarding);
        Onboarding.vouch(d.onboardingIssuer, k.onboarding, id, ClaimTopics.NOTE_ELIGIBLE, until, _recordHash(wallet, "note"));
        vm.stopBroadcast();
    }

    /// The bank, as the pool's liquidity provider, has an identity like any participant (ADR 0090),
    /// managed by its own key, so that it can admit itself to the pool. Its deposit is its own
    /// account, allowlisted, so it needs no deposit claim.
    function _onboardBank(Scaffolding.Deployed memory d, Keys memory k) private {
        address bank = vm.addr(k.bank);
        vm.startBroadcast(k.bank);
        IIdentity id = IIdentity(d.idFactory.createIdentity(bank, vm.toString(bank)));
        d.depositRegistry.registerIdentity(bank, id, Scaffolding.COUNTRY);
        vm.stopBroadcast();
    }

    /// Stands in for the salted hash of the verified record an institution keeps off-chain.
    function _recordHash(address wallet, string memory by) private pure returns (bytes32) {
        return keccak256(abi.encode(wallet, by, "verified record"));
    }

    /// @dev The local node's chain id. Anywhere else, including a fork of a public network,
    ///      a missing value stops the deployment.
    uint256 constant LOCAL_CHAIN_ID = 31337;

    function _param(string memory key, string memory localDefault) private view returns (string memory) {
        if (block.chainid == LOCAL_CHAIN_ID) return vm.envOr(key, localDefault);
        return vm.envString(key);
    }

    function _manifest() private view returns (string memory) {
        return string.concat("../", vm.envOr("MANIFEST", string("ops/addresses.json")));
    }

    function _record(Scaffolding.Deployed memory d, address onboardingAgent, address bank) private {
        string memory o = "identity";
        vm.serializeAddress(o, "idFactory", address(d.idFactory));
        vm.serializeAddress(o, "trexFactory", address(d.trexFactory));
        vm.serializeAddress(o, "noteFactory", address(d.noteFactory));
        vm.serializeAddress(o, "trexAuthority", address(d.trexAuthority));
        vm.serializeAddress(o, "identityStorage", address(d.identities));
        vm.serializeAddress(o, "bankIssuer", address(d.bankIssuer));
        vm.serializeAddress(o, "onboardingIssuer", address(d.onboardingIssuer));
        vm.serializeAddress(o, "depositRegistry", address(d.depositRegistry));
        vm.serializeAddress(o, "depositTopics", address(d.depositTopics));
        vm.serializeUint(o, "depositEligibleTopic", ClaimTopics.DEPOSIT_ELIGIBLE);
        vm.serializeUint(o, "noteEligibleTopic", ClaimTopics.NOTE_ELIGIBLE);
        vm.serializeUint(o, "termSheetTopic", ClaimTopics.TERM_SHEET);
        vm.serializeUint(o, "poolAccessTopic", ClaimTopics.POOL_ACCESS);
        vm.serializeAddress(o, "poolRegistry", address(d.poolRegistry));
        vm.serializeAddress(o, "poolTopics", address(d.poolTopics));
        vm.serializeAddress(o, "poolIssuers", address(d.poolIssuers));
        vm.writeJson(vm.serializeAddress(o, "depositIssuers", address(d.depositIssuers)), _manifest(), ".identity");

        string memory i = "instruments";
        vm.serializeAddress(i, "deposit", address(d.deposit));
        vm.writeJson(vm.serializeAddress(i, "gateway", address(d.gateway)), _manifest(), ".instruments");

        vm.writeJson(_token("deposit", address(d.deposit), d.deposit.symbol(), 2), _manifest(), ".assets.deposit");
        vm.writeJson(vm.toString(onboardingAgent), _manifest(), ".parties.onboardingAgent");
        vm.writeJson(vm.toString(bank), _manifest(), ".parties.depositAgent");
    }

    function _token(string memory key, address token, string memory symbol, uint256 decimals)
        private
        returns (string memory)
    {
        vm.serializeAddress(key, "address", token);
        vm.serializeString(key, "symbol", symbol);
        return vm.serializeUint(key, "decimals", decimals);
    }
}
