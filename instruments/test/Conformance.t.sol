// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {Test, Vm} from "forge-std/Test.sol";
import {IRuleEngine} from "debt-standard/interfaces/engine/IRuleEngine.sol";
import {StructuredNote} from "../src/StructuredNote.sol";
import {TokenizedDeposit} from "../src/TokenizedDeposit.sol";
import {IToken, IERC7943Fungible, MockGate, Deploy} from "./Fixtures.sol";

/**
 * ERC-7943 conformance and the six adaptations of spike 2, run against both instruments.
 * Spike 2 ran these against its composition; they now run against the contracts themselves.
 */
abstract contract ConformanceTest is Test {
    IToken t;
    MockGate gate;
    address admin = makeAddr("admin");
    address holderA = makeAddr("holderA");
    address holderB = makeAddr("holderB");
    address outsider = makeAddr("outsider");
    address controller = makeAddr("controller");

    function _impl() internal virtual returns (address);
    function _decimals() internal pure virtual returns (uint8);

    function setUp() public virtual {
        gate = new MockGate();
        gate.setEligible(holderA, true);
        gate.setEligible(holderB, true);
        t = Deploy.token(_impl(), admin, "T", _decimals(), keccak256("terms"), address(gate));
        vm.startPrank(admin);
        t.grantRole(keccak256("MINTER_ROLE"), admin);
        t.grantRole(keccak256("PAUSER_ROLE"), admin);
        t.grantRole(keccak256("ENFORCER_ROLE"), admin);
        t.grantRole(keccak256("ERC20ENFORCER_ROLE"), admin);
        t.grantRole(keccak256("FORCED_TRANSFER_ROLE"), controller);
        t.mint(holderA, 100);
        vm.stopPrank();
    }

    function test_interfaceId() public view {
        assertEq(type(IERC7943Fungible).interfaceId, bytes4(0x3edbb4c4));
        assertTrue(t.supportsInterface(0x3edbb4c4));
    }

    function test_decimalsAsInitialised() public view {
        assertEq(t.decimals(), _decimals());
    }

    /// A1: the account views consult eligibility and freezing.
    function test_accountViews() public {
        assertTrue(t.canSend(holderA));
        assertTrue(t.canReceive(holderB));
        assertFalse(t.canReceive(outsider));
        assertFalse(t.canSend(outsider));
        vm.prank(admin);
        t.setAddressFrozen(holderB, true);
        assertFalse(t.canReceive(holderB));
        assertFalse(t.canSend(holderB));
    }

    /// A2: no view reverts, under every gate failure mode, and each fails closed.
    function test_viewsNeverRevert() public {
        for (uint8 m = 1; m <= uint8(MockGate.Mode.Empty); m++) {
            gate.setMode(MockGate.Mode(m));
            assertFalse(t.canSend(holderA), "canSend");
            assertFalse(t.canReceive(holderB), "canReceive");
            assertFalse(t.canTransfer(holderA, holderB, 1), "canTransfer");
        }
    }

    function test_viewsNeverRevert_gateWithoutCode() public {
        vm.prank(admin);
        t.setRuleEngine(IRuleEngine(makeAddr("no code")));
        assertFalse(t.canSend(holderA));
        assertFalse(t.canTransfer(holderA, holderB, 1));
    }

    /// canTransfer tests unfrozen amount, pause, and both ends, but not balance alone.
    function test_canTransferRules() public {
        assertTrue(t.canTransfer(holderA, holderB, 50));
        assertTrue(t.canTransfer(holderA, holderB, 1000), "must not answer false on balance alone");
        assertFalse(t.canTransfer(holderA, outsider, 1), "receive check");
        assertFalse(t.canTransfer(outsider, holderB, 0), "send check");
        vm.prank(admin);
        t.setFrozenTokens(holderA, 60);
        assertTrue(t.canTransfer(holderA, holderB, 40));
        assertFalse(t.canTransfer(holderA, holderB, 41), "exceeds unfrozen");
        vm.prank(admin);
        t.pause();
        assertFalse(t.canTransfer(holderA, holderB, 1), "paused");
        assertTrue(t.paused(), "paused() is exposed, for the venue");
    }

    /// Public transfers never succeed where canTransfer says no.
    function test_transferConsistentWithCanTransfer() public {
        vm.prank(holderA);
        vm.expectRevert();
        t.transfer(outsider, 1);
        vm.prank(admin);
        t.setFrozenTokens(holderA, 90);
        vm.prank(holderA);
        vm.expectRevert();
        t.transfer(holderB, 11);
        vm.prank(holderA);
        t.transfer(holderB, 10);
    }

    /// A6: a mint tests only the recipient, a burn only the sender.
    function test_canTransferMintBurn() public view {
        assertTrue(t.canTransfer(address(0), holderB, 1));
        assertFalse(t.canTransfer(address(0), outsider, 1));
        assertTrue(t.canTransfer(holderA, address(0), 1));
    }

    function test_mintRespectsReceive() public {
        vm.prank(admin);
        vm.expectRevert();
        t.mint(outsider, 1);
    }

    function test_freezeBeyondBalance() public {
        vm.expectEmit(true, false, false, true, address(t));
        emit IERC7943Fungible.Frozen(holderA, 500);
        vm.prank(admin);
        t.setFrozenTokens(holderA, 500);
        assertEq(t.getFrozenTokens(holderA), 500);
    }

    /// A4: the admin holds no role it was not granted.
    function test_adminHoldsOnlyGrantedRoles() public view {
        assertFalse(t.hasRole(keccak256("FORCED_TRANSFER_ROLE"), admin));
        assertFalse(t.hasRole(keccak256("PROXY_UPGRADE_ROLE"), admin));
        assertFalse(t.hasRole(keccak256("BURNER_ROLE"), admin));
    }

    /// An upgrade needs the upgrade role, which the admin does not hold.
    function test_upgradeNeedsItsOwnRole() public {
        address next = _impl();
        vm.prank(admin);
        vm.expectRevert();
        t.upgradeToAndCall(next, "");
    }

    /// A5: forced transfer, in both forms, only under its own role.
    function test_forcedTransferRole() public {
        vm.startPrank(admin);
        vm.expectRevert();
        t.forcedTransfer(holderA, holderB, 1, "reason");
        vm.expectRevert();
        t.forcedTransfer(holderA, holderB, 1);
        vm.stopPrank();
    }

    /// A3: forced transfer never delivers to an account that cannot receive.
    function test_forcedTransferNeverToIneligible() public {
        vm.prank(controller);
        vm.expectRevert();
        t.forcedTransfer(holderA, outsider, 1, "reason");
    }

    /// Frozen before Transfer before ForcedTransfer, and the written reason travels whole.
    function test_forcedTransferFromFrozenAccount_eventOrder() public {
        vm.startPrank(admin);
        t.setFrozenTokens(holderA, 100);
        t.setAddressFrozen(holderA, true);
        vm.stopPrank();
        string memory written = "Register correction 2026-117: units delivered to the wrong account on the 24th";
        vm.recordLogs();
        vm.prank(controller);
        t.forcedTransfer(holderA, holderB, 30, bytes(written));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 frozen = keccak256("Frozen(address,uint256)");
        bytes32 transfer = keccak256("Transfer(address,address,uint256)");
        bytes32 forced = keccak256("ForcedTransfer(address,address,uint256)");
        bytes32 forced7551 = keccak256("ForcedTransfer(address,address,address,uint256,bytes)");
        uint256 iFrozen = type(uint256).max;
        uint256 iTransfer;
        uint256 iForced;
        bytes memory reason;
        for (uint256 i; i < logs.length; i++) {
            bytes32 s = logs[i].topics[0];
            if (s == frozen && iFrozen == type(uint256).max) iFrozen = i;
            if (s == transfer) iTransfer = i;
            if (s == forced) iForced = i;
            if (s == forced7551) (, reason) = abi.decode(logs[i].data, (uint256, bytes));
        }
        assertLt(iFrozen, iTransfer, "Frozen before Transfer");
        assertLt(iTransfer, iForced, "ForcedTransfer after Transfer");
        assertEq(string(reason), written, "reason carried whole");
        assertEq(t.balanceOf(holderB), 30);
        assertEq(t.getFrozenTokens(holderA), 70);
    }
}

contract NoteConformanceTest is ConformanceTest {
    function _impl() internal override returns (address) { return address(new StructuredNote()); }
    function _decimals() internal pure override returns (uint8) { return 0; }
}

contract DepositConformanceTest is ConformanceTest {
    function _impl() internal override returns (address) { return address(new TokenizedDeposit()); }
    function _decimals() internal pure override returns (uint8) { return 2; }
}
