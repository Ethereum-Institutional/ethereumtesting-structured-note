// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";

contract IdentityRegistryTest is Test {
    IdentityRegistry r;
    address agent = makeAddr("agent multi-signature");
    address agentKey = makeAddr("Agent issuing key");
    address secondKey = makeAddr("second registrar issuing key");
    address investor = makeAddr("investor");
    address other = makeAddr("other investor");

    uint16 constant AGENT = 1;
    uint16 constant SECOND = 2;
    uint40 constant YEAR = 365 days;
    uint32 flags;

    function setUp() public {
        vm.warp(1_790_000_000);
        r = new IdentityRegistry(agent, YEAR);
        vm.startPrank(agent);
        r.setRegistrar(agentKey, AGENT);
        r.setRegistrar(secondKey, SECOND);
        vm.stopPrank();
        flags = r.HOLD() | r.RECEIVE() | r.TRANSFER() | r.REG_S() | r.SANCTIONS_CLEAR();
    }

    function _grant(address key, address account, uint40 validFor) internal {
        vm.prank(key);
        r.grant(account, flags, 276, uint40(block.timestamp) + validFor, keccak256("credential"), keccak256("salted record"));
    }

    function test_grantIsLiveUntilExpiry() public {
        _grant(agentKey, investor, 30 days);
        (uint32 f, uint16 j) = r.liveFlags(investor);
        assertEq(f, flags);
        assertEq(j, 276);
        IIdentityRegistry.Grant memory g = r.grantOf(investor);
        assertEq(g.registrar, AGENT);
        assertEq(r.commitmentOf(investor), keccak256("salted record"));
    }

    /// Bounded in time: the grant lapses with no further action.
    function test_grantLapsesAtExpiry() public {
        _grant(agentKey, investor, 30 days);
        vm.warp(block.timestamp + 30 days);
        (uint32 f,) = r.liveFlags(investor);
        assertEq(f, 0, "lapsed at expiry, not after");
    }

    /// The validity window is a parameter, and no grant exceeds it.
    function test_expiryBoundedByMaxValidity() public {
        vm.prank(agentKey);
        vm.expectRevert();
        r.grant(investor, flags, 276, uint40(block.timestamp) + YEAR + 1, 0, 0);
        vm.prank(agentKey);
        vm.expectRevert();
        r.grant(investor, flags, 276, uint40(block.timestamp), 0, 0);
    }

    /// Revocable immediately.
    function test_revocationIsImmediate() public {
        _grant(agentKey, investor, 30 days);
        vm.prank(agentKey);
        r.revoke(investor);
        (uint32 f,) = r.liveFlags(investor);
        assertEq(f, 0);
        assertEq(r.commitmentOf(investor), bytes32(0));
    }

    /// Scoped by registrar: a second registrar cannot touch the Agent's participant.
    function test_registrarCannotActOnAnothersParticipant() public {
        _grant(agentKey, investor, 30 days);
        vm.startPrank(secondKey);
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.NotYourParticipant.selector, investor, AGENT));
        r.revoke(investor);
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.NotYourParticipant.selector, investor, AGENT));
        r.grant(investor, flags, 276, uint40(block.timestamp) + 1 days, 0, 0);
        vm.stopPrank();
    }

    /// A lapsed grant still belongs to its registrar; only revocation frees the address.
    function test_lapsedGrantKeepsItsRegistrarUntilRevoked() public {
        _grant(agentKey, investor, 1 days);
        vm.warp(block.timestamp + 2 days);
        vm.prank(secondKey);
        vm.expectRevert();
        r.grant(investor, flags, 276, uint40(block.timestamp) + 1 days, 0, 0);
        vm.prank(agentKey);
        r.revoke(investor);
        _grant(secondKey, investor, 1 days);
        assertEq(r.grantOf(investor).registrar, SECOND);
    }

    function test_onlyIssuingKeysWrite() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.NotAnIssuingKey.selector, agent));
        r.grant(investor, flags, 276, uint40(block.timestamp) + 1 days, 0, 0);
        vm.prank(other);
        vm.expectRevert();
        r.revoke(investor);
    }

    function test_onlyAdminAppointsKeys() public {
        vm.prank(agentKey);
        vm.expectRevert();
        r.setRegistrar(other, 3);
    }

    /// Removing an issuing key stops it writing at once.
    function test_removedKeyCannotWrite() public {
        vm.prank(agent);
        r.setRegistrar(secondKey, 0);
        vm.prank(secondKey);
        vm.expectRevert();
        r.grant(other, flags, 276, uint40(block.timestamp) + 1 days, 0, 0);
    }

    /// The supervisor withdraws another registrar's participant, with its reason on the record.
    function test_supervisorWithdrawsAnyGrantWithAReason() public {
        address supervisor = makeAddr("governance controller");
        bytes32 role = r.SUPERVISOR_ROLE();
        vm.prank(agent);
        r.grantRole(role, supervisor);
        _grant(secondKey, investor, 30 days);

        vm.prank(supervisor);
        vm.expectRevert(IIdentityRegistry.NoReason.selector);
        r.withdraw(investor, "");

        string memory reason = "Sanctions designation notified 24 September 2026";
        vm.expectEmit(true, true, false, true, address(r));
        emit IIdentityRegistry.Withdrawn(investor, SECOND, reason);
        vm.prank(supervisor);
        r.withdraw(investor, reason);
        (uint32 f,) = r.liveFlags(investor);
        assertEq(f, 0);
    }

    /// Neither the admin nor an issuing key holds supervisory withdrawal by default.
    function test_withdrawalNeedsItsOwnRole() public {
        _grant(agentKey, investor, 30 days);
        vm.prank(agent);
        vm.expectRevert();
        r.withdraw(investor, "reason");
        vm.prank(agentKey);
        vm.expectRevert();
        r.withdraw(investor, "reason");
    }

    /// One storage read per check.
    function test_checkIsOneStorageRead() public {
        _grant(agentKey, investor, 30 days);
        vm.record();
        r.liveFlags(investor);
        (bytes32[] memory reads,) = vm.accesses(address(r));
        assertEq(reads.length, 1);
    }
}
