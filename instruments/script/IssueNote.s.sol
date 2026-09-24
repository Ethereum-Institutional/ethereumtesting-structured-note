// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {Script, console2} from "forge-std/Script.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {StructuredNote} from "../src/StructuredNote.sol";
import {TokenizedDeposit} from "../src/TokenizedDeposit.sol";
import {DepositGateway} from "../src/DepositGateway.sol";
import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {Instruments} from "./Instruments.sol";
import {Lifecycle} from "./Lifecycle.sol";

interface IApprove {
    function approve(address spender, uint256 value) external returns (bool);
    function mint(address account, uint256 value) external;
}

interface IDeposit {
    function credit(address account, uint256 amount, bytes32 bookingRef) external;
}

/**
 * Issues the note on the local stack: fixes the terms, attaches the lifecycle contracts, mints
 * notional to the Issuer's inventory, and places units with investors A and B by DvP.
 *
 * The terms are the illustrative ones of spike 3, not the term sheet. **Dates are offsets from the
 * chain's own clock at issuance**, so a local chain never carries a calendar that has already
 * passed: four quarterly observations, each with its Record Time two days and Payment Date five
 * days after it.
 *
 * Run from instruments/ after DeployInstruments. Extends the manifest under `lifecycle`.
 */
contract IssueNote is Script {
    string constant MANIFEST = "../ops/addresses.json";
    uint256 constant QUARTER = 91 days;
    uint256 constant ISSUED_UNITS = 100;

    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        uint256 agentPk = vm.envUint("AGENT_PK");
        address issuer = vm.addr(issuerPk);
        address agent = vm.addr(agentPk);
        address calculationAgent = vm.addr(vm.envUint("CALCULATION_AGENT_PK"));
        string memory j = vm.readFile(MANIFEST);
        Instruments.Deployed memory d = _deployed(j);

        vm.startBroadcast(issuerPk);
        Lifecycle.Issued memory l = Lifecycle.issue(
            d, _terms(), Lifecycle.Config(issuer, calculationAgent, agent, issuer, agent)
        );
        vm.stopBroadcast();

        // The Paying Agent holds the cash leg in transit; the settlement contract takes
        // allowances, which the debt standard grants only to a spender that could send.
        IdentityRegistry r = d.registry;
        uint32 contractFlags = r.HOLD() | r.RECEIVE() | r.TRANSFER() | r.SANCTIONS_CLEAR() | r.CONTRACT_ACCOUNT();
        uint40 until = uint40(block.timestamp + 365 days);
        vm.startBroadcast(vm.envUint("ACCESS_ISSUER_PK"));
        r.grant(address(l.payingAgent), contractFlags, 276, until, keccak256("Paying Agent"), 0);
        r.grant(address(l.settlement), contractFlags | r.REG_S(), 276, until, keccak256("DvP settlement"), 0);
        r.grant(agent, r.HOLD() | r.RECEIVE() | r.TRANSFER() | r.SANCTIONS_CLEAR(), 276, until, keccak256("Agent"), 0);
        vm.stopBroadcast();

        vm.startBroadcast(vm.envUint("DEPOSIT_AGENT_PK"));
        IDeposit(address(d.gateway)).credit(agent, 10_000_000_00, "funding/agent");
        vm.stopBroadcast();

        vm.startBroadcast(agentPk);
        IApprove(address(d.deposit)).approve(address(l.payingAgent), type(uint256).max);
        IApprove(address(d.note)).mint(issuer, ISSUED_UNITS);
        vm.stopBroadcast();

        _place(l, d, issuerPk, vm.envUint("INVESTOR_A_PK"), 10);
        _place(l, d, issuerPk, vm.envUint("INVESTOR_B_PK"), 5);

        console2.log("determinations:", address(l.determinations));
        console2.log("paying agent  :", address(l.payingAgent));
        console2.log("settlement    :", address(l.settlement));
        _record(l, calculationAgent);
    }

    /// Placement: the inventory sells at par, the investor accepts, both legs settle together.
    function _place(
        Lifecycle.Issued memory l,
        Instruments.Deployed memory d,
        uint256 issuerPk,
        uint256 investorPk,
        uint64 units
    ) private {
        address issuer = vm.addr(issuerPk);
        address investor = vm.addr(investorPk);
        vm.startBroadcast(issuerPk);
        IApprove(address(d.note)).approve(address(l.settlement), units);
        uint256 id = l.settlement.propose(issuer, investor, units, uint256(units) * 100_000, uint48(block.timestamp + 1 days));
        vm.stopBroadcast();
        vm.startBroadcast(investorPk);
        IApprove(address(d.deposit)).approve(address(l.settlement), uint256(units) * 100_000);
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
        t.schedule = new IDeterminationAgent.Observation[](4);
        for (uint256 k = 0; k < 4; ++k) {
            uint48 date = uint48(block.timestamp + (k + 1) * QUARTER);
            t.schedule[k] = IDeterminationAgent.Observation(
                date, date + 2 days, date + 5 days, true, k < 3, k == 3, k == 3, k < 3 ? 10_000 : 0
            );
        }
    }

    function _deployed(string memory j) private pure returns (Instruments.Deployed memory d) {
        d.registry = IdentityRegistry(vm.parseJsonAddress(j, ".instruments.registry"));
        d.note = StructuredNote(vm.parseJsonAddress(j, ".instruments.note"));
        d.deposit = TokenizedDeposit(vm.parseJsonAddress(j, ".instruments.deposit"));
        d.gateway = DepositGateway(vm.parseJsonAddress(j, ".instruments.gateway"));
    }

    function _record(Lifecycle.Issued memory l, address calculationAgent) private {
        string memory o = "lifecycle";
        vm.serializeAddress(o, "determinations", address(l.determinations));
        vm.serializeAddress(o, "recordDates", address(l.recordDates));
        vm.serializeAddress(o, "payingAgent", address(l.payingAgent));
        vm.writeJson(vm.serializeAddress(o, "settlement", address(l.settlement)), MANIFEST, ".lifecycle");
        vm.writeJson(vm.toString(calculationAgent), MANIFEST, ".parties.calculationAgent");
    }
}
