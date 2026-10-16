// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {LockedSettlement} from "../src/LockedSettlement.sol";
import {NoteFactory} from "../src/factory/NoteFactory.sol";
import {Scaffolding} from "./Scaffolding.sol";
import {Issuance} from "./Issuance.sol";
import {Programme} from "./Programme.sol";
import {Manifest} from "./Manifest.sol";
import {WalletExec} from "./WalletExec.sol";

interface IApprove {
    function approve(address spender, uint256 value) external returns (bool);
}

/**
 * Issues the deployment's first note through the note factory, in one transaction signed by the
 * Issuer's multi-signature wallet (ADR 0115): its series identity, its terms, its T-REX suite, its
 * lifecycle contracts allowlisted on the deposit, the notional minted to the Issuer's inventory,
 * the note opened, and the note handed to the governance controller. The bank then funds the
 * Agent's account, and units are placed with investors A and B by locked offer. No standing
 * approval: each distribution is approved for its amount when it opens.
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
        address issuer = vm.addr(issuerPk);
        address agent = vm.addr(vm.envUint("AGENT_PK"));
        string memory j = vm.readFile(_manifest());
        Scaffolding.Deployed memory d = Manifest.scaffolding(j);
        Programme.Deployed memory p = Manifest.programme(j);
        // The term sheet, built by site/scripts/term-sheet.ts: the input to issuance (ADR 0095).
        string memory ts = vm.readFile(_termSheet());

        NoteFactory.Params memory params = Issuance.params(
            _terms(ts),
            Issuance.Config({
                issuer: issuer,
                isin: "",
                name: vm.parseJsonString(ts, ".record.fields.name.value"),
                symbol: vm.parseJsonString(ts, ".record.fields.symbol.value"),
                termSheetHash: vm.parseJsonBytes32(ts, ".hash"),
                termSheetUri: vm.parseJsonString(ts, ".uri"),
                // The notional to the Issuer's inventory, and the note opened, in the same act.
                units: vm.parseJsonUint(ts, ".terms.units"),
                open: true
            })
        );
        // The Issuer's wallet issues: two of its three signers sign, and the deployer submits.
        vm.startBroadcast(issuerPk);
        WalletExec.exec(
            vm.parseJsonAddress(j, ".governance.issuerGovernance"),
            address(p.factory),
            abi.encodeCall(NoteFactory.issue, (params)),
            _issuerSigners()
        );
        vm.stopBroadcast();
        Issuance.Issued memory l = Issuance.issued(p.factory.noteOf(p.factory.tokenOfSeries(p.factory.seriesCount())));

        // The bank funds the Agent's account, which each distribution draws on.
        vm.startBroadcast(vm.envUint("DEPOSIT_AGENT_PK"));
        d.gateway.credit(agent, 10_000_000_00, "funding/agent");
        vm.stopBroadcast();

        _place(l, d, issuerPk, vm.envUint("INVESTOR_A_PK"), 10);
        _place(l, d, issuerPk, vm.envUint("INVESTOR_B_PK"), 5);

        console2.log("note          :", address(l.note));
        console2.log("determinations:", address(l.determinations));
        console2.log("paying agent  :", address(l.payingAgent));
        console2.log("settlement    :", address(l.settlement));
        _record(l, vm.addr(vm.envUint("CALCULATION_AGENT_PK")));
    }

    /// The Issuer's wallet's first two signers: mnemonic indices 13 and 14.
    function _issuerSigners() private view returns (uint256[] memory keys) {
        string memory m = block.chainid == 31337 ? "test test test test test test test test test test test junk" : vm.envString("WALLET_MNEMONIC");
        keys = new uint256[](2);
        keys[0] = vm.deriveKey(m, 13);
        keys[1] = vm.deriveKey(m, 14);
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
        vm.serializeUint(n, "series", l.series);
        vm.serializeAddress(n, "identity", l.identity);
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
