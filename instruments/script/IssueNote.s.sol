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
 * The note is issued from its term sheet (ADR 0095), which site/scripts/term-sheet.ts builds just
 * before: its name, symbol, size and terms are the record's, and the record's hash and address are
 * anchored on the note's identity. The figures are the illustrative ones of spike 3, with Twin Win
 * applicable (C5, ADR 0015), dated from the chain's own clock.
 *
 * Run from instruments/ after DeployInstruments. Extends the manifest under `noteSuite` and `lifecycle`.
 */
contract IssueNote is Script {

    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        uint256 agentPk = vm.envUint("AGENT_PK");
        address issuer = vm.addr(issuerPk);
        address agent = vm.addr(agentPk);
        address calculationAgent = vm.addr(vm.envUint("CALCULATION_AGENT_PK"));
        Scaffolding.Deployed memory d = Manifest.scaffolding(vm.readFile(_manifest()));
        // The term sheet, built by site/scripts/term-sheet.ts: the input to issuance (ADR 0095).
        string memory ts = vm.readFile(_termSheet());

        vm.startBroadcast(issuerPk);
        Issuance.Issued memory l = Issuance.issue(
            d,
            _terms(ts),
            Issuance.Config({
                issuer: issuer,
                calculationAgent: calculationAgent,
                payer: agent,
                funder: agent,
                name: vm.parseJsonString(ts, ".record.fields.name.value"),
                symbol: vm.parseJsonString(ts, ".record.fields.symbol.value"),
                salt: string.concat("note-", vm.toString(block.timestamp)),
                termSheetHash: vm.parseJsonBytes32(ts, ".hash"),
                termSheetUri: vm.parseJsonString(ts, ".uri"),
                // The notional to the Issuer's inventory, and the note opened, in the same act.
                units: vm.parseJsonUint(ts, ".terms.units"),
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

    /// The terms the term sheet gives, as site/scripts/term-sheet.ts derived them from it.
    function _terms(string memory ts) private pure returns (IDeterminationAgent.Terms memory t) {
        t.initialLevels = vm.parseJsonUintArray(ts, ".terms.initialLevels");
        t.calculationAmountCents = uint64(vm.parseJsonUint(ts, ".terms.calculationAmountCents"));
        t.couponBarrierBps = uint32(vm.parseJsonUint(ts, ".terms.couponBarrierBps"));
        t.couponRateBps = uint32(vm.parseJsonUint(ts, ".terms.couponRateBps"));
        t.memory_ = vm.parseJsonBool(ts, ".terms.memory");
        t.barrierBps = uint32(vm.parseJsonUint(ts, ".terms.barrierBps"));
        t.twinWin = IDeterminationAgent.TwinWin(
            vm.parseJsonBool(ts, ".terms.twinWin.applies"),
            uint32(vm.parseJsonUint(ts, ".terms.twinWin.upBps")),
            uint32(vm.parseJsonUint(ts, ".terms.twinWin.downBps")),
            uint32(vm.parseJsonUint(ts, ".terms.twinWin.capBps"))
        );
        uint256 n = vm.parseJsonUint(ts, ".terms.scheduleLength");
        t.schedule = new IDeterminationAgent.Observation[](n);
        for (uint256 k = 0; k < n; ++k) {
            string memory o = string.concat(".terms.schedule[", vm.toString(k), "]");
            t.schedule[k] = IDeterminationAgent.Observation(
                uint48(vm.parseJsonUint(ts, string.concat(o, ".date"))),
                uint48(vm.parseJsonUint(ts, string.concat(o, ".recordTime"))),
                uint48(vm.parseJsonUint(ts, string.concat(o, ".paymentDate"))),
                vm.parseJsonBool(ts, string.concat(o, ".coupon")),
                vm.parseJsonBool(ts, string.concat(o, ".mer")),
                vm.parseJsonBool(ts, string.concat(o, ".barrier")),
                vm.parseJsonBool(ts, string.concat(o, ".isFinal")),
                uint32(vm.parseJsonUint(ts, string.concat(o, ".merTriggerBps")))
            );
        }
    }

    function _termSheet() private view returns (string memory) {
        return string.concat("../", vm.envOr("TERM_SHEET_FILE", string("ops/term-sheet.json")));
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
        vm.serializeString(t, "symbol", vm.parseJsonString(vm.readFile(_termSheet()), ".record.fields.symbol.value"));
        vm.writeJson(vm.serializeUint(t, "decimals", 0), _manifest(), ".assets.note");
    }

    function _manifest() private view returns (string memory) {
        return string.concat("../", vm.envOr("MANIFEST", string("ops/addresses.json")));
    }
}
