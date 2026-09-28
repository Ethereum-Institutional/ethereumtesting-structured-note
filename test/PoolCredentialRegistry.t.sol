// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {PoolCredentialRegistry} from "../contracts/PoolCredentialRegistry.sol";
import {ICredentialIssuers, ICredentialRevocations} from "../contracts/interfaces/ICredentialProtocol.sol";
import {CredentialProtocolStandIn} from "./fixtures/CredentialProtocolStandIn.sol";

/**
 * The pool's credential gate against a stand-in for the protocol's registries. Needs no chain:
 *
 *   forge test --match-path test/PoolCredentialRegistry.t.sol
 *
 * Every refusal has a positive control: the same attestation with the one value corrected is
 * granted, so no refusal can pass for the wrong reason.
 */
contract PoolCredentialRegistryTest is Test {
    string constant DID = "did:example:credential-issuer";
    bytes32 constant ENTITY_SCHEMA = keccak256("schema:corporate-identity/v1");
    bytes32 constant PERSON_SCHEMA = keccak256("schema:passport/v1");
    bytes32 constant SCREENING_SCHEMA = keccak256("schema:screening/v1");

    CredentialProtocolStandIn protocol;
    PoolCredentialRegistry gate;

    address admin = makeAddr("admin");
    address attester = makeAddr("attester");
    address supervisor = makeAddr("supervisor");
    address holder = makeAddr("holder");

    function setUp() public {
        vm.warp(1_790_000_000);
        protocol = new CredentialProtocolStandIn();
        protocol.setActive(DID, true);
        gate = new PoolCredentialRegistry(_config(0));
        bytes32 role = gate.SUPERVISOR_ROLE();
        vm.prank(admin);
        gate.grantRole(role, supervisor);
    }

    function _config(uint40 freshness) internal view returns (PoolCredentialRegistry.Config memory c) {
        bytes2[] memory js = new bytes2[](3);
        js[0] = "DE";
        js[1] = "CH";
        js[2] = "GB";
        c = PoolCredentialRegistry.Config({
            admin: admin,
            attester: attester,
            issuers: ICredentialIssuers(address(protocol)),
            revocations: ICredentialRevocations(address(protocol)),
            issuerDid: DID,
            entity: PoolCredentialRegistry.PathPolicy(ENTITY_SCHEMA, ENTITY_SCHEMA, 1 | 2 | 4 | 16),
            person: PoolCredentialRegistry.PathPolicy(PERSON_SCHEMA, SCREENING_SCHEMA, 1 | 2 | 8 | 16 | 32),
            jurisdictions: js,
            investorClasses: uint8(1 << 1 | 1 << 2),
            maxValidity: 90 days,
            screeningMaxAge: 30 days,
            rootFreshness: freshness,
            entityRequiresAuthority: true
        });
    }

    /// A natural person who meets every parameter.
    function _person() internal view returns (PoolCredentialRegistry.Attestation memory a) {
        a = PoolCredentialRegistry.Attestation({
            account: holder,
            path: PoolCredentialRegistry.Path.Person,
            primaryCredential: keccak256("passport credential"),
            screeningCredential: keccak256("screening credential"),
            walletCredential: keccak256("wallet-control credential"),
            authorityCredential: bytes32(0),
            primarySchema: PERSON_SCHEMA,
            screeningSchema: SCREENING_SCHEMA,
            checks: 1 | 2 | 8 | 16 | 32,
            jurisdiction: "DE",
            investorClass: 1,
            screenedAt: uint40(block.timestamp - 1 days),
            credentialExpiry: uint40(block.timestamp + 365 days),
            evidence: keccak256("verification record")
        });
    }

    function _grant(PoolCredentialRegistry.Attestation memory a) internal returns (uint40) {
        vm.prank(attester);
        return gate.grant(a);
    }

    function _expectRefused(PoolCredentialRegistry.Attestation memory a, bytes memory err) internal {
        vm.prank(attester);
        vm.expectRevert(err);
        gate.grant(a);
    }

    // --- admission ---

    /// A participant meeting the policy is admitted, and only once granted.
    function test_meetingThePolicy_isAdmitted() public {
        assertFalse(gate.isAllowed(holder), "no grant, no access");
        _grant(_person());
        assertTrue(gate.isAllowed(holder), "granted");
    }

    /// An entity presents its corporate identity alone: the screening rides inside it (ADR 0033).
    function _entity() internal view returns (PoolCredentialRegistry.Attestation memory a) {
        a = _person();
        a.path = PoolCredentialRegistry.Path.Entity;
        a.primarySchema = ENTITY_SCHEMA;
        a.screeningSchema = ENTITY_SCHEMA;
        a.screeningCredential = a.primaryCredential;
        a.authorityCredential = keccak256("officer credential");
        a.checks = 1 | 2 | 4 | 16;
        a.investorClass = 2;
    }

    /// An entity is admitted on its own path, with that path's checks.
    function test_entityPath() public {
        PoolCredentialRegistry.Attestation memory a = _entity();
        a.checks = 1 | 2 | 16; // not active
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.ChecksMissing.selector, uint32(4)));
        a.checks = 1 | 2 | 4; // screening not reported clean
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.ChecksMissing.selector, uint32(16)));
        a.checks = 1 | 2 | 4 | 16;
        _grant(a);
        assertTrue(gate.isAllowed(holder));
    }

    /// The entity's screening is its corporate identity: a separate screening credential is refused.
    function test_entityScreening_isTheCorporateIdentityItself() public {
        PoolCredentialRegistry.Attestation memory a = _entity();
        a.screeningCredential = keccak256("a separate screening credential");
        _expectRefused(
            a, abi.encodeWithSelector(PoolCredentialRegistry.ScreeningNotInCredential.selector, a.screeningCredential)
        );
        a.screeningSchema = SCREENING_SCHEMA;
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.SchemaNotAccepted.selector, SCREENING_SCHEMA));
    }

    /// The wallet binding is a credential too: a grant needs one, and it must not be revoked.
    function test_walletCredential_requiredAndNotRevoked() public {
        PoolCredentialRegistry.Attestation memory a = _entity();
        a.walletCredential = bytes32(0);
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.NoWalletCredential.selector));
        a = _entity();
        protocol.setRevoked(DID, a.walletCredential, true);
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.CredentialRevoked.selector, a.walletCredential));
        protocol.setRevoked(DID, a.walletCredential, false);
        _grant(a);
    }

    /// Revoking the wallet binding voids the grant, by anyone's call (ADR 0043).
    function test_walletRevocation_voidsTheGrant() public {
        PoolCredentialRegistry.Attestation memory a = _entity();
        _grant(a);
        protocol.setRevoked(DID, a.walletCredential, true);
        vm.expectEmit(address(gate));
        emit PoolCredentialRegistry.AccessVoided(holder, a.walletCredential);
        gate.void(holder);
        assertFalse(gate.isAllowed(holder));
    }

    /// Where the policy does not require an officer, an entity is admitted without one (ADR 0054).
    function test_authorityCredential_optionalByPolicy() public {
        PoolCredentialRegistry.Config memory c = _config(0);
        c.entityRequiresAuthority = false;
        gate = new PoolCredentialRegistry(c);
        PoolCredentialRegistry.Attestation memory a = _entity();
        a.authorityCredential = bytes32(0);
        _grant(a);
        assertTrue(gate.isAllowed(holder));
    }

    /// An entity needs the presenting officer's credential; a person presents for itself.
    function test_authorityCredential_requiredForEntity_absentForPerson() public {
        PoolCredentialRegistry.Attestation memory a = _entity();
        a.authorityCredential = bytes32(0);
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.AuthorityCredentialRequired.selector));
        PoolCredentialRegistry.Attestation memory p = _person();
        p.authorityCredential = keccak256("an officer credential on a person");
        _expectRefused(p, abi.encodeWithSelector(PoolCredentialRegistry.AuthorityCredentialNotExpected.selector));
    }

    /// The officer leaving ends the grant: a revoked officer credential is refused, and voids.
    function test_officerRevocation_refusedAndVoids() public {
        PoolCredentialRegistry.Attestation memory a = _entity();
        protocol.setRevoked(DID, a.authorityCredential, true);
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.CredentialRevoked.selector, a.authorityCredential));
        protocol.setRevoked(DID, a.authorityCredential, false);
        _grant(a);
        protocol.setRevoked(DID, a.authorityCredential, true);
        vm.expectEmit(address(gate));
        emit PoolCredentialRegistry.AccessVoided(holder, a.authorityCredential);
        gate.void(holder);
        assertFalse(gate.isAllowed(holder));
    }

    /// Revoking the one corporate identity credential voids the entity's grant.
    function test_entityRevocation_voidsTheGrant() public {
        PoolCredentialRegistry.Attestation memory a = _entity();
        _grant(a);
        protocol.setRevoked(DID, a.primaryCredential, true);
        gate.void(holder);
        assertFalse(gate.isAllowed(holder));
    }

    /// The configured issuer must be active in the protocol.
    function test_inactiveIssuer_refused() public {
        protocol.setActive(DID, false);
        _expectRefused(_person(), abi.encodeWithSelector(PoolCredentialRegistry.IssuerNotActive.selector));
        protocol.setActive(DID, true);
        _grant(_person());
    }

    /// Neither credential may be revoked.
    function test_revokedCredential_refused() public {
        PoolCredentialRegistry.Attestation memory a = _person();
        protocol.setRevoked(DID, a.screeningCredential, true);
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.CredentialRevoked.selector, a.screeningCredential));
        protocol.setRevoked(DID, a.screeningCredential, false);
        protocol.setRevoked(DID, a.primaryCredential, true);
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.CredentialRevoked.selector, a.primaryCredential));
        protocol.setRevoked(DID, a.primaryCredential, false);
        _grant(a);
    }

    /// A schema other than the path's own is refused, even one the other path accepts.
    function test_wrongSchema_refused() public {
        PoolCredentialRegistry.Attestation memory a = _person();
        a.primarySchema = ENTITY_SCHEMA;
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.SchemaNotAccepted.selector, ENTITY_SCHEMA));
    }

    /// Every required check must be reported passed; the missing ones are named.
    function test_missingChecks_named() public {
        PoolCredentialRegistry.Attestation memory a = _person();
        a.checks = 1 | 2 | 8; // sanctions screen and PEP missing
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.ChecksMissing.selector, uint32(16 | 32)));
        a.checks = 2 | 8 | 16 | 32; // wallet control missing
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.ChecksMissing.selector, uint32(1)));
    }

    /// A jurisdiction outside the allowlist is refused.
    function test_jurisdictionOutsideAllowlist_refused() public {
        PoolCredentialRegistry.Attestation memory a = _person();
        a.jurisdiction = "US";
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.JurisdictionNotAllowed.selector, bytes2("US")));
        a.jurisdiction = "CH";
        _grant(a);
    }

    /// Only the configured investor classes are accepted.
    function test_investorClass_refused() public {
        PoolCredentialRegistry.Attestation memory a = _person();
        a.investorClass = 3; // retail
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.InvestorClassNotAllowed.selector, uint8(3)));
        a.investorClass = 0; // sophisticated
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.InvestorClassNotAllowed.selector, uint8(0)));
        a.investorClass = 9; // not a class
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.InvestorClassNotAllowed.selector, uint8(9)));
        a.investorClass = 2;
        _grant(a);
    }

    /// A screening older than the policy allows, or dated in the future, is refused.
    function test_staleScreening_refused() public {
        PoolCredentialRegistry.Attestation memory a = _person();
        a.screenedAt = uint40(block.timestamp - 30 days - 1);
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.ScreeningTooOld.selector, a.screenedAt));
        a.screenedAt = uint40(block.timestamp + 1);
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.ScreeningTooOld.selector, a.screenedAt));
        a.screenedAt = uint40(block.timestamp - 30 days);
        _grant(a);
    }

    /// An expired credential is refused.
    function test_expiredCredential_refused() public {
        PoolCredentialRegistry.Attestation memory a = _person();
        a.credentialExpiry = uint40(block.timestamp);
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.CredentialExpired.selector, a.credentialExpiry));
    }

    /// Only the attester writes grants.
    function test_onlyAttesterGrants() public {
        PoolCredentialRegistry.Attestation memory a = _person();
        bytes memory err =
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, admin, gate.ATTESTER_ROLE());
        vm.prank(admin);
        vm.expectRevert(err);
        gate.grant(a);
    }

    // --- bounded in time ---

    /// The grant runs to the earlier of the credential's expiry and the maximum validity.
    function test_expiryIsTheEarlierBound() public {
        uint40 capped = _grant(_person());
        assertEq(capped, uint40(block.timestamp + 90 days), "maximum validity");

        PoolCredentialRegistry.Attestation memory a = _person();
        a.credentialExpiry = uint40(block.timestamp + 10 days);
        assertEq(_grant(a), a.credentialExpiry, "credential expiry");
    }

    /// A grant lapses without any transaction.
    function test_grantLapses() public {
        uint40 expiresAt = _grant(_person());
        vm.warp(expiresAt - 1);
        assertTrue(gate.isAllowed(holder));
        vm.warp(expiresAt);
        assertFalse(gate.isAllowed(holder), "lapsed at the exact second");
    }

    // --- revocable at once ---

    /// Anyone may void a grant once the protocol revokes its credential, and not before.
    function test_anyoneVoidsOnRevocation() public {
        PoolCredentialRegistry.Attestation memory a = _person();
        _grant(a);
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PoolCredentialRegistry.NotVoidable.selector, holder));
        gate.void(holder);

        protocol.setRevoked(DID, a.screeningCredential, true);
        vm.prank(stranger);
        vm.expectEmit(address(gate));
        emit PoolCredentialRegistry.AccessVoided(holder, a.screeningCredential);
        gate.void(holder);
        assertFalse(gate.isAllowed(holder));
    }

    /// Deactivating the issuer lets anyone suspend every grant, permanently.
    function test_issuerDeactivation_suspendsEveryGrant() public {
        _grant(_person());
        vm.expectRevert(PoolCredentialRegistry.IssuerStillActive.selector);
        gate.suspendIssuer();

        protocol.setActive(DID, false);
        gate.suspendIssuer();
        assertFalse(gate.isAllowed(holder), "suspended");

        protocol.setActive(DID, true);
        assertFalse(gate.isAllowed(holder), "reactivation does not resume this gate");
        _expectRefused(_person(), abi.encodeWithSelector(PoolCredentialRegistry.IssuerIsSuspended.selector));
    }

    /// Supervisory withdrawal is immediate, carries its reason whole, and needs one.
    function test_supervisoryWithdrawal() public {
        _grant(_person());
        vm.prank(supervisor);
        vm.expectRevert(PoolCredentialRegistry.NoReason.selector);
        gate.withdraw(holder, "");

        string memory reason = "Sanctions designation notified by the screening provider, reference 2026-0917";
        vm.prank(supervisor);
        vm.expectEmit(address(gate));
        emit PoolCredentialRegistry.AccessWithdrawn(holder, reason);
        gate.withdraw(holder, reason);
        assertFalse(gate.isAllowed(holder));
    }

    /// The attester's revocation, and nobody else's.
    function test_attesterRevokes() public {
        _grant(_person());
        vm.prank(admin);
        vm.expectRevert();
        gate.revoke(holder);
        vm.prank(attester);
        gate.revoke(holder);
        assertFalse(gate.isAllowed(holder));
    }

    // --- the swap path ---

    /// The read on the swap path makes no call to the protocol, so a failing protocol cannot
    /// revert a swap, and it costs two storage reads.
    function test_isAllowed_neverCallsTheProtocol() public {
        _grant(_person());
        protocol.setBroken(true);
        vm.record();
        assertTrue(gate.isAllowed(holder));
        (bytes32[] memory reads,) = vm.accesses(address(gate));
        assertEq(reads.length, 2, "suspension flag and the grant's expiry");
    }

    /// And a write fails rather than passes when the protocol cannot answer.
    function test_grantFailsClosedWhenProtocolFails() public {
        protocol.setBroken(true);
        vm.prank(attester);
        vm.expectRevert();
        gate.grant(_person());
    }

    // --- root freshness, when configured ---

    function test_rootFreshness_whenConfigured() public {
        gate = new PoolCredentialRegistry(_config(7 days));
        _expectRefused(_person(), abi.encodeWithSelector(PoolCredentialRegistry.RootNotRecent.selector));
        protocol.publishRoot(DID, keccak256("root"));
        _grant(_person());
        vm.warp(block.timestamp + 8 days);
        PoolCredentialRegistry.Attestation memory a = _person();
        _expectRefused(a, abi.encodeWithSelector(PoolCredentialRegistry.RootNotRecent.selector));
    }

    // --- configuration ---

    function test_configurationRefusesUnsafeValues() public {
        PoolCredentialRegistry.Config memory c = _config(0);
        c.person.requiredChecks = 2 | 8; // wallet control not required
        vm.expectRevert(
            abi.encodeWithSelector(PoolCredentialRegistry.InvalidConfiguration.selector, "wallet control not required")
        );
        new PoolCredentialRegistry(c);

        c = _config(0);
        c.jurisdictions[1] = "de";
        vm.expectRevert(abi.encodeWithSelector(PoolCredentialRegistry.InvalidConfiguration.selector, "jurisdiction"));
        new PoolCredentialRegistry(c);

        c = _config(366 days);
        vm.expectRevert(
            abi.encodeWithSelector(PoolCredentialRegistry.InvalidConfiguration.selector, "freshness window too long")
        );
        new PoolCredentialRegistry(c);
    }

    /// No attribute value is stored: a grant holds only identifiers, the path and the expiry.
    function test_storesNoAttributeValue() public {
        vm.record();
        _grant(_person());
        (, bytes32[] memory writes) = vm.accesses(address(gate));
        assertEq(writes.length, 6, "packed expiry and path, four credential ids, evidence");
    }

    /// The gate never reverts on the swap path, whatever the account.
    function testFuzz_isAllowedNeverReverts(address anyone, uint40 at) public {
        _grant(_person());
        vm.warp(at);
        gate.isAllowed(anyone);
    }
}
