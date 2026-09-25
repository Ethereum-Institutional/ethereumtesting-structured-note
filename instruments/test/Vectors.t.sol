// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {Instruments} from "../script/Instruments.sol";
import {Lifecycle} from "../script/Lifecycle.sol";

/**
 * Spike 3, S-34: every scenario in the independent model's grid, reproduced to the cent, end to
 * end. For each case the Calculation Agent signs the outcome the model computed; the
 * Determination Agent must compute the same outcome or refuse it; the Paying Agent then pays the
 * holders of record, burns at redemption, and must close with every holder paid exactly
 * amount-per-CA times units and nothing left outstanding.
 *
 * The cases come from spikes/payoff/vectors.json through test/vectors/flatten.py.
 */
contract VectorsTest is Test {
    string json;
    Instruments.Deployed d;

    uint256 caKey = 0xCA11;
    address calculationAgent;
    address agent = makeAddr("Agent");
    address accessIssuer = makeAddr("Access Issuer");
    address depositAgent = makeAddr("Deposit Agent");
    address inventory = makeAddr("issuer-inventory");
    address[3] holders = [makeAddr("investor-a"), makeAddr("investor-b"), makeAddr("custody-nominee")];
    uint256[3] units = [uint256(3), 7, 2];
    uint256 constant INVENTORY_UNITS = 5;

    function setUp() public {
        json = vm.readFile("test/vectors/cases.json");
        calculationAgent = vm.addr(caKey);
        vm.warp(1_780_000_000); // before every date in the grid
        d = Instruments.deploy(
            Instruments.Config(address(this), agent, accessIssuer, depositAgent, 3 * 365 days, 0, "", "N", "N", "D", "D")
        );
    }

    function _s(uint256 c, string memory key) internal pure returns (string memory) {
        return string.concat(".cases[", vm.toString(c), "].", key);
    }

    function _terms(uint256 c) internal view returns (IDeterminationAgent.Terms memory t) {
        t.initialLevels = vm.parseJsonUintArray(json, _s(c, "initialLevels"));
        t.calculationAmountCents = uint64(vm.parseJsonUint(json, _s(c, "calculationAmountCents")));
        t.couponBarrierBps = uint32(vm.parseJsonUint(json, _s(c, "couponBarrierBps")));
        t.couponRateBps = uint32(vm.parseJsonUint(json, _s(c, "couponRateBps")));
        t.memory_ = vm.parseJsonBool(json, _s(c, "memory"));
        t.barrierBps = uint32(vm.parseJsonUint(json, _s(c, "barrierBps")));
        t.twinWin = IDeterminationAgent.TwinWin(
            vm.parseJsonBool(json, _s(c, "twinWin")),
            uint32(vm.parseJsonUint(json, _s(c, "twinUpBps"))),
            uint32(vm.parseJsonUint(json, _s(c, "twinDownBps"))),
            uint32(vm.parseJsonUint(json, _s(c, "twinCapBps")))
        );
        uint256[] memory dates = vm.parseJsonUintArray(json, _s(c, "dates"));
        bool[] memory coupon = vm.parseJsonBoolArray(json, _s(c, "coupon"));
        bool[] memory mer = vm.parseJsonBoolArray(json, _s(c, "mer"));
        bool[] memory barrier = vm.parseJsonBoolArray(json, _s(c, "barrier"));
        bool[] memory fin = vm.parseJsonBoolArray(json, _s(c, "final"));
        uint256[] memory trig = vm.parseJsonUintArray(json, _s(c, "merTriggerBps"));
        uint256 recordAfter = vm.parseJsonUint(json, ".recordAfter");
        uint256 paymentAfter = vm.parseJsonUint(json, ".paymentAfter");
        t.schedule = new IDeterminationAgent.Observation[](dates.length);
        for (uint256 k = 0; k < dates.length; ++k) {
            t.schedule[k] = IDeterminationAgent.Observation(
                uint48(dates[k]),
                uint48(dates[k] + recordAfter),
                uint48(dates[k] + paymentAfter),
                coupon[k],
                mer[k],
                barrier[k],
                fin[k],
                uint32(trig[k])
            );
        }
    }

    function _claimed(uint256 c, uint256 k) internal view returns (IDeterminationAgent.Outcome memory o) {
        string memory p = string.concat(_s(c, "outcomes["), vm.toString(k), "].");
        o.breached = vm.parseJsonBool(json, string.concat(p, "breached"));
        o.couponPaid = vm.parseJsonBool(json, string.concat(p, "couponPaid"));
        o.couponPerCa = uint64(vm.parseJsonUint(json, string.concat(p, "couponPerCa")));
        o.redeemed = vm.parseJsonBool(json, string.concat(p, "redeemed"));
        o.redemptionPerCa = uint64(vm.parseJsonUint(json, string.concat(p, "redemptionPerCa")));
        o.worstIndex = uint8(vm.parseJsonUint(json, string.concat(p, "worstIndex")));
    }

    function test_everyScenarioToTheCent() public {
        uint256 cases = abi.decode(vm.parseJson(json, ".cases"), (bytes[])).length;
        assertEq(cases, 25);
        for (uint256 c = 0; c < cases; ++c) {
            uint256 snap = vm.snapshotState();
            _run(c);
            vm.revertToState(snap);
        }
    }

    function _run(uint256 c) internal {
        string memory name = vm.parseJsonString(json, _s(c, "name"));
        Lifecycle.Issued memory l =
            Lifecycle.issue(d, _terms(c), Lifecycle.Config(address(this), calculationAgent, agent, inventory, agent));
        _onboardAndPlace(l);

        uint256 last = vm.parseJsonUint(json, _s(c, "terminatedIndex"));
        for (uint256 k = 0; k <= last; ++k) {
            IDeterminationAgent.Observation memory obs = l.determinations.observation(k);
            vm.warp(obs.date);
            uint256[] memory levels =
                vm.parseJsonUintArray(json, string.concat(_s(c, "levels["), vm.toString(k), "]"));
            IDeterminationAgent.Outcome memory claimed = _claimed(c, k);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(caKey, l.determinations.digest(k, levels, claimed));
            l.determinations.determine(k, levels, claimed, abi.encodePacked(r, s, v));

            vm.warp(obs.paymentDate);
            if (claimed.couponPaid) _distribute(l.payingAgent, k, PayingAgent.Kind.Coupon, claimed.couponPerCa, name);
            if (claimed.redeemed) {
                _distribute(l.payingAgent, k, PayingAgent.Kind.Redemption, claimed.redemptionPerCa, name);
            }
        }
        assertTrue(l.determinations.terminated(), name);
        assertEq(d.note.totalSupply(), 0, string.concat(name, ": zero positions"));
        assertEq(d.deposit.balanceOf(address(l.payingAgent)), 0, string.concat(name, ": nothing left in the Paying Agent"));
    }

    function _distribute(PayingAgent pa, uint256 k, PayingAgent.Kind kind, uint256 perCa, string memory name) internal {
        uint256[3] memory before;
        for (uint256 h = 0; h < 3; ++h) before[h] = d.deposit.balanceOf(holders[h]);
        vm.startPrank(agent);
        bytes32 id = pa.open(k, kind);
        address[] memory batch = new address[](3);
        for (uint256 h = 0; h < 3; ++h) batch[h] = holders[h];
        pa.pay(id, batch);
        vm.stopPrank();
        for (uint256 h = 0; h < 3; ++h) {
            assertEq(d.deposit.balanceOf(holders[h]) - before[h], perCa * units[h], name);
        }
        (,,, uint64 paid,, bool closed,,,,) = pa.distributions(id);
        assertTrue(closed, string.concat(name, ": closed"));
        assertEq(paid, 12, name);
        assertEq(d.deposit.balanceOf(inventory), 0, string.concat(name, ": inventory is never paid"));
    }

    function _onboardAndPlace(Lifecycle.Issued memory l) internal {
        uint32 flags = d.registry.HOLD() | d.registry.RECEIVE() | d.registry.TRANSFER() | d.registry.SANCTIONS_CLEAR()
            | d.registry.REG_S();
        uint40 until = uint40(block.timestamp + 3 * 365 days);
        vm.startPrank(accessIssuer);
        for (uint256 h = 0; h < 3; ++h) d.registry.grant(holders[h], flags, 276, until, 0, 0);
        d.registry.grant(inventory, flags, 276, until, 0, 0);
        d.registry.grant(agent, flags, 276, until, 0, 0);
        d.registry.grant(address(l.payingAgent), flags | d.registry.CONTRACT_ACCOUNT(), 276, until, 0, 0);
        vm.stopPrank();

        vm.prank(depositAgent);
        d.gateway.credit(agent, 1_000_000_000_00, "funding");
        vm.startPrank(agent);
        d.deposit.approve(address(l.payingAgent), type(uint256).max);
        for (uint256 h = 0; h < 3; ++h) d.note.mint(holders[h], units[h]);
        d.note.mint(inventory, INVENTORY_UNITS);
        vm.stopPrank();
    }
}
