// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {InstrumentGate} from "../src/InstrumentGate.sol";

contract InstrumentGateTest is Test {
    IdentityRegistry r;
    InstrumentGate regS;
    InstrumentGate anywhere;
    address agent = makeAddr("agent multi-signature");
    address key = makeAddr("issuing key");
    address regSHolder = makeAddr("Reg S holder");
    address rule144aHolder = makeAddr("Rule 144A holder");
    address receiveOnly = makeAddr("receive only");
    address abroad = makeAddr("outside the permitted jurisdictions");
    address nobody = makeAddr("no grant");

    uint32 base;

    function setUp() public {
        vm.warp(1_790_000_000);
        r = new IdentityRegistry(agent, 365 days);
        vm.prank(agent);
        r.setRegistrar(key, 1);
        base = r.HOLD() | r.SANCTIONS_CLEAR();

        uint16[] memory permitted = new uint16[](2);
        permitted[0] = 276;
        permitted[1] = 250;
        regS = new InstrumentGate(r, base | r.TRANSFER() | r.REG_S(), base | r.RECEIVE() | r.REG_S(), permitted);
        anywhere = new InstrumentGate(r, base | r.TRANSFER(), base | r.RECEIVE(), new uint16[](0));

        uint32 both = base | r.RECEIVE() | r.TRANSFER();
        _grant(regSHolder, both | r.REG_S(), 276);
        _grant(rule144aHolder, both | r.RULE_144A(), 276);
        _grant(receiveOnly, base | r.RECEIVE() | r.REG_S(), 250);
        _grant(abroad, both | r.REG_S(), 840);
    }

    function _grant(address a, uint32 flags, uint16 j) internal {
        vm.prank(key);
        r.grant(a, flags, j, uint40(block.timestamp) + 30 days, 0, 0);
    }

    /// A Regulation S instrument requires the Regulation S flag.
    function test_maskSelectsTheRegime() public view {
        assertTrue(regS.canReceive(regSHolder));
        assertFalse(regS.canReceive(rule144aHolder), "no Reg S flag");
        assertTrue(anywhere.canReceive(rule144aHolder), "a different gate, a different mask");
    }

    function test_sendAndReceiveAreSeparateRights() public view {
        assertTrue(regS.canReceive(receiveOnly));
        assertFalse(regS.canSend(receiveOnly));
    }

    function test_jurisdictionOutsidePermittedSet() public view {
        assertFalse(regS.canReceive(abroad));
        assertTrue(anywhere.canReceive(abroad), "no jurisdiction restriction on this gate");
    }

    function test_noGrantNoRights() public view {
        assertFalse(anywhere.canReceive(nobody));
        assertFalse(anywhere.canSend(nobody));
    }

    function test_lapsedGrantNoRights() public {
        vm.warp(block.timestamp + 30 days);
        assertFalse(regS.canReceive(regSHolder));
        assertFalse(regS.canSend(regSHolder));
    }

    /// A zero mask still needs a live grant.
    function test_zeroMaskStillNeedsAGrant() public {
        InstrumentGate open = new InstrumentGate(r, 0, 0, new uint16[](0));
        assertFalse(open.canReceive(nobody));
        assertTrue(open.canReceive(regSHolder));
    }

    /// G1: the callback reverts exactly when canTransfer is false.
    function testFuzz_callbackAgreesWithCanTransfer(uint8 f, uint8 t) public view {
        address[6] memory who = [address(0), regSHolder, rule144aHolder, receiveOnly, abroad, nobody];
        address from = who[f % 6];
        address to = who[t % 6];
        bool allowed = regS.canTransfer(from, to, 1);
        bool expected = to == address(0) || ((from == address(0) || regS.canSend(from)) && regS.canReceive(to));
        assertEq(allowed, expected, "canTransfer follows the account views");
        (bool ok,) = address(regS).staticcall(abi.encodeWithSignature("transferred(address,address,uint256)", from, to, 1));
        assertEq(ok, allowed, "callback agrees");
        (ok,) = address(regS).staticcall(
            abi.encodeWithSignature("transferred(address,address,address,uint256)", address(this), from, to, 1)
        );
        assertEq(ok, allowed, "spender form agrees");
    }

    /// G3 default: a burn tests nothing here.
    function test_burnPassesForALapsedHolder() public {
        vm.warp(block.timestamp + 30 days);
        assertTrue(regS.canTransfer(regSHolder, address(0), 1));
    }

    /// G2: far inside the token's 100,000 gas bound, cold.
    function test_viewsAreCheap() public view {
        uint256 before = gasleft();
        regS.canTransfer(regSHolder, receiveOnly, 1);
        uint256 used = before - gasleft();
        assertLt(used, 30_000, "canTransfer, two accounts, cold");
    }
}
