// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {LockedSettlement} from "../src/LockedSettlement.sol";
import {Scaffolding} from "./Scaffolding.sol";
import {Issuance} from "./Issuance.sol";
import {Manifest} from "./Manifest.sol";

interface IApprove {
    function approve(address spender, uint256 value) external returns (bool);
}

/**
 * Issues the note on the scaffolding through the note factory, in one transaction (ADRs 0088,
 * 0091): its terms, its T-REX suite with its lifecycle attached, the notional minted to the
 * Issuer's inventory and the note opened for transfers. The bank then allowlists the lifecycle
 * contracts and funds the Agent, the Agent lets the Paying Agent draw its funds, and units are
 * placed with investors A and B by locked offer.
 *
 * The terms are the illustrative ones of spike 3, not the term sheet, with Twin Win applicable at
 * 100% participation each way, capped at 150% (C5, ADR 0015). **Dates are offsets from the
 * chain's own clock at issuance**, so a local chain never carries a calendar that has already
 * passed: four quarterly observations, each with its Record Time two days and Payment Date five
 * days after it.
 *
 * Run from instruments/ after DeployInstruments. Extends the manifest under `noteSuite` and `lifecycle`.
 */
contract IssueNote is Script {
    uint256 constant QUARTER = 91 days;
    uint256 constant ISSUED_UNITS = 100;

    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        uint256 agentPk = vm.envUint("AGENT_PK");
        address issuer = vm.addr(issuerPk);
        address agent = vm.addr(agentPk);
        address calculationAgent = vm.addr(vm.envUint("CALCULATION_AGENT_PK"));
        Scaffolding.Deployed memory d = Manifest.scaffolding(vm.readFile(_manifest()));

        vm.startBroadcast(issuerPk);
        Issuance.Issued memory l = Issuance.issue(
            d,
            _terms(),
            Issuance.Config({
                issuer: issuer,
                calculationAgent: calculationAgent,
                payer: agent,
                funder: agent,
                name: _param("NOTE_NAME", "EUR Worst-of Autocallable Note"),
                symbol: _param("NOTE_SYMBOL", "EURWAN"),
                salt: string.concat("note-", vm.toString(block.timestamp)),
                // Local defaults. On any other chain each value must be set explicitly (ADR 0027).
                termSheetHash: _hashParam("TERM_SHEET_HASH", keccak256("term sheet, draft")),
                termSheetUri: _param("TERM_SHEET_URI", "pending"),
                // The notional to the Issuer's inventory, and the note opened, in the same act.
                units: ISSUED_UNITS,
                open: true
            })
        );
        vm.stopBroadcast();

        // The bank allowlists the lifecycle contracts for its deposit and funds the Agent.
        vm.startBroadcast(vm.envUint("DEPOSIT_AGENT_PK"));
        Issuance.allowlist(d, l);
        d.gateway.credit(agent, 10_000_000_00, "funding/agent");
        vm.stopBroadcast();

        vm.startBroadcast(agentPk);
        IApprove(address(d.deposit)).approve(address(l.payingAgent), type(uint256).max);
        vm.stopBroadcast();

        _place(l, d, issuerPk, vm.envUint("INVESTOR_A_PK"), 10);
        _place(l, d, issuerPk, vm.envUint("INVESTOR_B_PK"), 5);

        console2.log("note          :", address(l.note));
        console2.log("determinations:", address(l.determinations));
        console2.log("paying agent  :", address(l.payingAgent));
        console2.log("settlement    :", address(l.settlement));
        _record(l, calculationAgent);
    }

    /// Placement: the inventory offers to sell at par, the investor accepts, both legs settle together.
    function _place(Issuance.Issued memory l, Scaffolding.Deployed memory d, uint256 issuerPk, uint256 investorPk, uint64 units)
        private
    {
        address investor = vm.addr(investorPk);
        uint256 price = uint256(units) * 100_000;
        vm.startBroadcast(issuerPk);
        IApprove(address(l.note)).approve(address(l.settlement), units);
        uint256 id = l.settlement.offer(LockedSettlement.Side.Sell, investor, units, price, uint48(block.timestamp + 1 days));
        vm.stopBroadcast();
        vm.startBroadcast(investorPk);
        IApprove(address(d.deposit)).approve(address(l.settlement), price);
        l.settlement.accept(id);
        vm.stopBroadcast();
    }

    function _terms() private view returns (IDeterminationAgent.Terms memory t) {
        t.initialLevels = new uint256[](3);
        t.initialLevels[0] = 451_200;
        t.initialLevels[1] = 1_820_300;
        t.initialLevels[2] = 25_000;
        t.calculationAmountCents = 100_000;
        t.couponBarrierBps = 7_000;
        t.couponRateBps = 250;
        t.barrierBps = 6_000;
        // C5: Twin Win applicable. Illustrative figures until the term sheet gives them (ADR 0015).
        t.twinWin = IDeterminationAgent.TwinWin(true, 10_000, 10_000, 15_000);
        t.schedule = new IDeterminationAgent.Observation[](4);
        for (uint256 k = 0; k < 4; ++k) {
            uint48 date = uint48(block.timestamp + (k + 1) * QUARTER);
            t.schedule[k] = IDeterminationAgent.Observation(
                date, date + 2 days, date + 5 days, true, k < 3, k == 3, k == 3, k < 3 ? 10_000 : 0
            );
        }
    }

    uint256 constant LOCAL_CHAIN_ID = 31337;

    function _param(string memory key, string memory localDefault) private view returns (string memory) {
        if (block.chainid == LOCAL_CHAIN_ID) return vm.envOr(key, localDefault);
        return vm.envString(key);
    }

    function _hashParam(string memory key, bytes32 localDefault) private view returns (bytes32) {
        if (block.chainid == LOCAL_CHAIN_ID) return vm.envOr(key, localDefault);
        return vm.envBytes32(key);
    }

    function _record(Issuance.Issued memory l, address calculationAgent) private {
        string memory n = "noteSuite";
        vm.serializeAddress(n, "identityRegistry", address(l.identityRegistry));
        vm.serializeAddress(n, "compliance", l.compliance);
        vm.serializeAddress(n, "trustedIssuers", l.trustedIssuers);
        vm.writeJson(vm.serializeAddress(n, "claimTopics", l.claimTopics), _manifest(), ".noteSuite");
        vm.writeJson(vm.toString(address(l.note)), _manifest(), ".instruments.note");

        string memory o = "lifecycle";
        vm.serializeAddress(o, "determinations", address(l.determinations));
        vm.serializeAddress(o, "recordDates", address(l.recordDates));
        vm.serializeAddress(o, "payingAgent", address(l.payingAgent));
        vm.writeJson(vm.serializeAddress(o, "settlement", address(l.settlement)), _manifest(), ".lifecycle");
        vm.writeJson(vm.toString(calculationAgent), _manifest(), ".parties.calculationAgent");

        string memory t = "note";
        vm.serializeAddress(t, "address", address(l.note));
        vm.serializeString(t, "symbol", _param("NOTE_SYMBOL", "EURWAN"));
        vm.writeJson(vm.serializeUint(t, "decimals", 0), _manifest(), ".assets.note");
    }

    function _manifest() private view returns (string memory) {
        return string.concat("../", vm.envOr("MANIFEST", string("ops/addresses.json")));
    }
}
