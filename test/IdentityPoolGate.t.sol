// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IdentityPoolGate, IPoolIdentityRegistry} from "../contracts/IdentityPoolGate.sol";

/// The pool's identity registry, reduced to what the gate asks: verified, and the country.
contract RegistryStandIn is IPoolIdentityRegistry {
    mapping(address => bool) public isVerified;
    mapping(address => uint16) public investorCountry;
    function set(address account, bool verified, uint16 country) external {
        isVerified[account] = verified;
        investorCountry[account] = country;
    }
}

/// A registry that reverts on every question.
contract RevertingRegistry {
    function isVerified(address) external pure returns (bool) {
        revert("down");
    }

    function investorCountry(address) external pure returns (uint16) {
        revert("down");
    }
}

/**
 * The pool's gate alone (ADR 0090), against a stand-in for the pool's identity registry. The
 * registry's own verification, claims and trusted issuers, is T-REX's, and is exercised end to end
 * against the deployment in test/PermissionedTrading.t.sol.
 *
 *   forge test --match-path test/IdentityPoolGate.t.sol
 */
contract IdentityPoolGateTest is Test {
    RegistryStandIn registry;
    IdentityPoolGate gate;
    address admin = makeAddr("admin");
    address supervisor = makeAddr("supervisor");
    address client = makeAddr("client");

    uint16 constant GERMANY = 276;
    uint16 constant SWITZERLAND = 756;
    uint16 constant UNITED_STATES = 840;

    function setUp() public {
        registry = new RegistryStandIn();
        uint16[] memory js = new uint16[](2);
        (js[0], js[1]) = (GERMANY, SWITZERLAND);
        gate = new IdentityPoolGate(admin, registry, js);
        bytes32 role = gate.SUPERVISOR_ROLE();
        vm.prank(admin);
        gate.grantRole(role, supervisor);
        registry.set(client, true, GERMANY);
    }

    function test_verifiedInAServedJurisdiction_isAllowed() public view {
        assertTrue(gate.isAllowed(client));
        assertTrue(gate.standing(client) == IdentityPoolGate.Standing.Allowed);
    }

    function test_notVerified_isRefused() public {
        registry.set(client, false, GERMANY);
        assertFalse(gate.isAllowed(client));
        assertTrue(gate.standing(client) == IdentityPoolGate.Standing.NotVerified);
    }

    function test_jurisdictionNotServed_isRefused() public {
        registry.set(client, true, UNITED_STATES);
        assertFalse(gate.isAllowed(client));
        assertTrue(gate.standing(client) == IdentityPoolGate.Standing.JurisdictionNotServed);
    }

    /// Withdrawal holds whatever the claim says, and lifting it lets the claim decide again.
    function test_withdrawalAndRestoration() public {
        vm.prank(supervisor);
        vm.expectEmit(address(gate));
        emit IdentityPoolGate.AccessWithdrawn(client, "Screening alert under review");
        gate.withdraw(client, "Screening alert under review");
        assertTrue(gate.standing(client) == IdentityPoolGate.Standing.Withdrawn);

        vm.prank(supervisor);
        vm.expectRevert(abi.encodeWithSelector(IdentityPoolGate.AlreadyWithdrawn.selector, client));
        gate.withdraw(client, "again");

        vm.prank(supervisor);
        gate.restore(client, "Review closed");
        assertTrue(gate.isAllowed(client));

        vm.prank(supervisor);
        vm.expectRevert(abi.encodeWithSelector(IdentityPoolGate.NotWithdrawn.selector, client));
        gate.restore(client, "again");
    }

    function test_onlyTheSupervisor_withAReason() public {
        bytes32 role = gate.SUPERVISOR_ROLE();
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, admin, role));
        vm.prank(admin);
        gate.withdraw(client, "x");

        vm.prank(supervisor);
        vm.expectRevert(IdentityPoolGate.NoReason.selector);
        gate.withdraw(client, "");
    }

    /// A registry that cannot answer denies; the gate never reverts on the swap path.
    function test_unanswerableRegistry_denies() public {
        uint16[] memory js = new uint16[](1);
        js[0] = GERMANY;
        IdentityPoolGate g = new IdentityPoolGate(admin, IPoolIdentityRegistry(address(new RevertingRegistry())), js);
        assertFalse(g.isAllowed(client));
    }

    function test_configurationIsChecked() public {
        uint16[] memory none = new uint16[](0);
        vm.expectRevert(abi.encodeWithSelector(IdentityPoolGate.InvalidConfiguration.selector, "no jurisdiction"));
        new IdentityPoolGate(admin, registry, none);

        uint16[] memory repeated = new uint16[](2);
        (repeated[0], repeated[1]) = (GERMANY, GERMANY);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityPoolGate.InvalidConfiguration.selector, "jurisdiction invalid or repeated")
        );
        new IdentityPoolGate(admin, registry, repeated);

        uint16[] memory one = new uint16[](1);
        one[0] = GERMANY;
        vm.expectRevert(abi.encodeWithSelector(IdentityPoolGate.InvalidConfiguration.selector, "no registry"));
        new IdentityPoolGate(admin, IPoolIdentityRegistry(makeAddr("nothing")), one);
    }
}
