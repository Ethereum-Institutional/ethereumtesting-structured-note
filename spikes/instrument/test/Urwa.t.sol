// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ICMTATConstructor} from "debt-standard/interfaces/technical/ICMTATConstructor.sol";
import {IERC1643CMTAT} from "debt-standard/interfaces/tokenization/draft-IERC1643CMTAT.sol";
import {IRuleEngine} from "debt-standard/interfaces/engine/IRuleEngine.sol";
import {SpikeF_Lean_Guarded} from "../src/F_Guarded.sol";
import {SpikeH_Adapted} from "../src/H_Adapted.sol";

/// ERC-7943 as published (Final), fungible interface.
interface IERC7943Fungible is IERC165 {
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount);
    event Frozen(address indexed account, uint256 amount);
    function forcedTransfer(address from, address to, uint256 amount) external returns (bool result);
    function setFrozenTokens(address account, uint256 amount) external returns (bool result);
    function canSend(address account) external view returns (bool allowed);
    function canReceive(address account) external view returns (bool allowed);
    function getFrozenTokens(address account) external view returns (uint256 amount);
    function canTransfer(address from, address to, uint256 amount) external view returns (bool allowed);
}

interface IToken is IERC7943Fungible {
    function initialize(address, ICMTATConstructor.ERC20Attributes memory, ICMTATConstructor.ExtraInformationAttributes memory, ICMTATConstructor.Engine memory) external;
    function setRuleEngine(IRuleEngine) external;
    function mint(address, uint256) external;
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function pause() external;
    function setAddressFrozen(address, bool) external;
    function forcedTransfer(address, address, uint256, bytes calldata) external returns (bool);
    function grantRole(bytes32, address) external;
    function hasRole(bytes32, address) external view returns (bool);
}

/// Eligibility gate with misbehaviour modes, to test that the token's views cannot revert.
contract MockGate {
    enum Mode { Normal, Revert, OutOfGas, LongReturn, NotBool, Empty }
    Mode public mode;
    mapping(address => bool) public eligible;
    function setMode(Mode m) external { mode = m; }
    function setEligible(address a, bool e) external { eligible[a] = e; }

    function _answer(bool v) internal view returns (bool) {
        Mode m = mode;
        if (m == Mode.Revert) revert("gate down");
        if (m == Mode.OutOfGas) { uint256 i; while (true) { i++; } }
        if (m == Mode.LongReturn) { assembly { mstore(0, 1) mstore(0x20, 1) return(0, 0x40) } }
        if (m == Mode.NotBool) { assembly { mstore(0, 2) return(0, 0x20) } }
        if (m == Mode.Empty) { assembly { return(0, 0) } }
        return v;
    }
    function canSend(address a) external view returns (bool) { return _answer(eligible[a]); }
    function canReceive(address a) external view returns (bool) { return _answer(eligible[a]); }
    function canTransfer(address f, address t, uint256) public view returns (bool) {
        return _answer((f == address(0) || eligible[f]) && (t == address(0) || eligible[t]));
    }
    function canTransferFrom(address, address f, address t, uint256 v) external view returns (bool) { return canTransfer(f, t, v); }
    function transferred(address f, address t, uint256 v) public view { require(canTransfer(f, t, v), "gate: not eligible"); }
    function transferred(address, address f, address t, uint256 v) external view { transferred(f, t, v); }
    function supportsInterface(bytes4) external pure returns (bool) { return true; }
}

abstract contract UrwaBase is Test {
    IToken t;
    MockGate gate;
    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address outsider = makeAddr("outsider");
    address controller = makeAddr("controller");

    function _impl() internal virtual returns (address);

    function setUp() public virtual {
        ICMTATConstructor.ERC20Attributes memory a = ICMTATConstructor.ERC20Attributes("Note", "NOTE", 0);
        ICMTATConstructor.ExtraInformationAttributes memory x =
            ICMTATConstructor.ExtraInformationAttributes("ID", IERC1643CMTAT.DocumentInfo("terms", "uri", bytes32(0)), "");
        bytes memory init = abi.encodeCall(IToken.initialize, (admin, a, x, ICMTATConstructor.Engine(IRuleEngine(address(0)))));
        t = IToken(address(new ERC1967Proxy(_impl(), init)));
        gate = new MockGate();
        gate.setEligible(alice, true);
        gate.setEligible(bob, true);
        vm.startPrank(admin);
        t.setRuleEngine(IRuleEngine(address(gate)));
        t.grantRole(keccak256("MINTER_ROLE"), admin);
        t.grantRole(keccak256("PAUSER_ROLE"), admin);
        t.grantRole(keccak256("ENFORCER_ROLE"), admin);
        t.grantRole(keccak256("ERC20ENFORCER_ROLE"), admin);
        t.mint(alice, 100);
        vm.stopPrank();
    }
}

/// The lean composition as the standard provides it, with no adaptation.
contract UnadaptedTest is UrwaBase {
    function _impl() internal override returns (address) { return address(new SpikeF_Lean_Guarded()); }

    function test_gap_canReceiveIgnoresEligibility() public view {
        assertTrue(t.canReceive(outsider), "unadapted: ineligible account reported as able to receive");
        assertFalse(t.canTransfer(alice, outsider, 1));
    }
    function test_gap_canTransferRevertsWhenGateReverts() public {
        gate.setMode(MockGate.Mode.Revert);
        vm.expectRevert();
        t.canTransfer(alice, bob, 1);
    }
    function test_gap_canTransferRevertsWhenGateMalformed() public {
        gate.setMode(MockGate.Mode.NotBool);
        vm.expectRevert();
        t.canTransfer(alice, bob, 1);
    }
    function test_gap_forcedTransferToIneligible() public {
        vm.prank(admin);
        t.forcedTransfer(alice, outsider, 10, "reason");
        assertEq(t.balanceOf(outsider), 10, "unadapted: forced transfer delivered to an ineligible holder");
    }
}

contract AdaptedTest is UrwaBase {
    function _impl() internal override returns (address) { return address(new SpikeH_Adapted()); }

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        t.grantRole(keccak256("FORCED_TRANSFER_ROLE"), controller);
    }

    // ERC-165
    function test_interfaceId() public view {
        assertEq(type(IERC7943Fungible).interfaceId, bytes4(0x3edbb4c4));
        assertTrue(t.supportsInterface(0x3edbb4c4));
    }

    // canSend / canReceive reflect eligibility and freezing
    function test_accountViews() public {
        assertTrue(t.canSend(alice));
        assertTrue(t.canReceive(bob));
        assertFalse(t.canReceive(outsider));
        assertFalse(t.canSend(outsider));
        vm.prank(admin);
        t.setAddressFrozen(bob, true);
        assertFalse(t.canReceive(bob));
        assertFalse(t.canSend(bob));
    }

    // MUST NOT revert, under every gate failure mode; fails closed
    function test_viewsNeverRevert() public {
        for (uint8 m = 1; m <= uint8(MockGate.Mode.Empty); m++) {
            gate.setMode(MockGate.Mode(m));
            assertFalse(t.canSend(alice), "canSend");
            assertFalse(t.canReceive(bob), "canReceive");
            assertFalse(t.canTransfer(alice, bob, 1), "canTransfer");
        }
    }
    function test_viewsNeverRevert_gateWithoutCode() public {
        vm.prank(admin);
        t.setRuleEngine(IRuleEngine(makeAddr("eoa")));
        assertFalse(t.canSend(alice));
        assertFalse(t.canTransfer(alice, bob, 1));
    }

    // canTransfer: unfrozen amount, pause, send/receive, but not balance
    function test_canTransferRules() public {
        assertTrue(t.canTransfer(alice, bob, 50));
        assertTrue(t.canTransfer(alice, bob, 1000), "must not return false on balance alone");
        assertFalse(t.canTransfer(alice, outsider, 1), "receive check");
        assertFalse(t.canTransfer(outsider, bob, 0), "send check");
        vm.prank(admin);
        t.setFrozenTokens(alice, 60);
        assertTrue(t.canTransfer(alice, bob, 40));
        assertFalse(t.canTransfer(alice, bob, 41), "exceeds unfrozen");
        vm.prank(admin);
        t.pause();
        assertFalse(t.canTransfer(alice, bob, 1), "paused");
    }

    // Public transfers must not succeed where canTransfer is false
    function test_transferConsistentWithCanTransfer() public {
        assertFalse(t.canTransfer(alice, outsider, 1));
        vm.prank(alice);
        vm.expectRevert();
        t.transfer(outsider, 1);
        vm.prank(admin);
        t.setFrozenTokens(alice, 90);
        vm.prank(alice);
        vm.expectRevert();
        t.transfer(bob, 11);
        vm.prank(alice);
        t.transfer(bob, 10);
    }

    // Mints and burns are transfers for canTransfer; only the real end is tested
    function test_canTransferMintBurn() public view {
        assertTrue(t.canTransfer(address(0), bob, 1));
        assertFalse(t.canTransfer(address(0), outsider, 1));
        assertTrue(t.canTransfer(alice, address(0), 1));
    }

    // Mint to an ineligible account fails
    function test_mintRespectsReceive() public {
        vm.prank(admin);
        vm.expectRevert();
        t.mint(outsider, 1);
    }

    // setFrozenTokens: may exceed balance, emits Frozen
    function test_freezeBeyondBalance() public {
        vm.expectEmit(true, false, false, true, address(t));
        emit IERC7943Fungible.Frozen(alice, 500);
        vm.prank(admin);
        t.setFrozenTokens(alice, 500);
        assertEq(t.getFrozenTokens(alice), 500);
    }

    // No implicit superuser
    function test_adminHoldsOnlyGrantedRoles() public view {
        assertFalse(t.hasRole(keccak256("FORCED_TRANSFER_ROLE"), admin));
        assertFalse(t.hasRole(keccak256("PROXY_UPGRADE_ROLE"), admin));
    }

    // forcedTransfer: dedicated role, receive check, event order, reason travels
    function test_forcedTransferRole() public {
        vm.prank(admin);
        vm.expectRevert();
        t.forcedTransfer(alice, bob, 1, "reason");
        vm.prank(admin);
        vm.expectRevert();
        t.forcedTransfer(alice, bob, 1);
    }
    function test_forcedTransferNeverToIneligible() public {
        vm.prank(controller);
        vm.expectRevert();
        t.forcedTransfer(alice, outsider, 1, "reason");
    }
    function test_forcedTransferFromFrozenAccount_eventOrder() public {
        vm.startPrank(admin);
        t.setFrozenTokens(alice, 100);
        t.setAddressFrozen(alice, true);
        vm.stopPrank();
        vm.recordLogs();
        vm.prank(controller);
        t.forcedTransfer(alice, bob, 30, "court order 2026-117");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 frozen = keccak256("Frozen(address,uint256)");
        bytes32 transfer = keccak256("Transfer(address,address,uint256)");
        bytes32 forced = keccak256("ForcedTransfer(address,address,uint256)");
        bytes32 forced7551 = keccak256("ForcedTransfer(address,address,address,uint256,bytes)");
        uint256 iFrozen = type(uint256).max; uint256 iTransfer; uint256 iForced; bytes memory reason;
        for (uint256 i; i < logs.length; i++) {
            bytes32 s = logs[i].topics[0];
            if (s == frozen && iFrozen == type(uint256).max) iFrozen = i;
            if (s == transfer) iTransfer = i;
            if (s == forced) iForced = i;
            if (s == forced7551) (, reason) = abi.decode(logs[i].data, (uint256, bytes));
        }
        assertLt(iFrozen, iTransfer, "Frozen before Transfer");
        assertLt(iTransfer, iForced, "ForcedTransfer after Transfer");
        assertEq(string(reason), "court order 2026-117", "reason carried in the event");
        assertEq(t.balanceOf(bob), 30);
        assertEq(t.getFrozenTokens(alice), 70);
    }
}
