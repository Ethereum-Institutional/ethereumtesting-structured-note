// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {IDeterminationAgent} from "../src/interfaces/IDeterminationAgent.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {Issuance} from "../script/Issuance.sol";
import {Stack, IERC20Like} from "./Stack.sol";

/**
 * Spike 3, S-34: every scenario in the independent model's grid, reproduced to the cent, end to
 * end. For each case the Calculation Agent signs the outcome the model computed; the
 * Determination Agent must compute the same outcome or refuse it; the Paying Agent then pays the
 * holders of record, burns at redemption, and must close with every holder paid exactly
 * amount-per-CA times units and nothing left outstanding.
 *
 * The cases come from spikes/payoff/vectors.json through test/vectors/flatten.py.
 */
contract VectorsTest is Stack {
    string json;

    address[3] holders = [makeAddr("investor-a"), makeAddr("investor-b"), makeAddr("custody-nominee")];
    uint256[3] units = [uint256(3), 7, 2];
    uint256 constant INVENTORY_UNITS = 5;

    function setUp() public {
        json = vm.readFile("test/vectors/cases.json");
        vm.warp(1_780_000_000); // before every date in the grid
        claimLife = 2 * 365 days; // past the last date in the grid
        _deployScaffolding();
        for (uint256 h = 0; h < 3; ++h) _onboard(holders[h], true);
        _onboard(inventory, true);
        _onboard(agent, true);
        _credit(agent, 1_000_000_000_00);
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

    /// Each scenario is a note of its own, issued on the same scaffolding to the same clients,
    /// whose identities and claims serve every note.
    function _run(uint256 c) internal {
        string memory name = vm.parseJsonString(json, _s(c, "name"));
        Issuance.Issued memory n = _issueNote(name, _terms(c));
        _fundAndPlace(n);

        uint256 last = vm.parseJsonUint(json, _s(c, "terminatedIndex"));
        for (uint256 k = 0; k <= last; ++k) {
            IDeterminationAgent.Observation memory obs = n.determinations.observation(k);
            vm.warp(obs.date);
            uint256[] memory levels =
                vm.parseJsonUintArray(json, string.concat(_s(c, "levels["), vm.toString(k), "]"));
            IDeterminationAgent.Outcome memory claimed = _claimed(c, k);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(CA_KEY, n.determinations.digest(k, levels, claimed));
            n.determinations.determine(k, levels, claimed, abi.encodePacked(r, s, v));

            vm.warp(obs.paymentDate);
            if (claimed.couponPaid) _distribute(n.payingAgent, k, PayingAgent.Kind.Coupon, claimed.couponPerCa, name);
            if (claimed.redeemed) {
                _distribute(n.payingAgent, k, PayingAgent.Kind.Redemption, claimed.redemptionPerCa, name);
            }
        }
        assertTrue(n.determinations.terminated(), name);
        assertEq(n.note.totalSupply(), 0, string.concat(name, ": zero positions"));
        assertEq(d.deposit.balanceOf(address(n.payingAgent)), 0, string.concat(name, ": nothing left in the Paying Agent"));
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

    function _fundAndPlace(Issuance.Issued memory n) internal {
        vm.prank(agent);
        IERC20Like(address(d.deposit)).approve(address(n.payingAgent), type(uint256).max);
        vm.startPrank(inventory);
        for (uint256 h = 0; h < 3; ++h) n.note.mint(holders[h], units[h]);
        n.note.mint(inventory, INVENTORY_UNITS);
        vm.stopPrank();
    }
}
