// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {IIdentity} from "@onchain-id/solidity/contracts/interface/IIdentity.sol";
import {Errors} from "@onchain-id/solidity/contracts/libraries/Errors.sol";
import {Token} from "t-rex/token/Token.sol";
import {IDepositGateway} from "../src/interfaces/IDepositGateway.sol";
import {IERC7943Fungible, DepositToken} from "../src/DepositToken.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {ClaimTopics} from "../src/claims/ClaimTopics.sol";
import {ExpiringClaimIssuer} from "../src/claims/ExpiringClaimIssuer.sol";
import {Onboarding} from "../script/Onboarding.sol";
import {Stack, IERC20Like} from "./Stack.sol";

interface IERC20From {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/**
 * The instruments and their identities (ADRs 0085 to 0088): the note as an ERC-3643 token, one
 * identity per client with claims by role, claims that lapse and can be revoked, agents limited
 * to their own powers, and the tokenized deposit's eligibility, spender check, freezing and forced
 * transfer.
 */
contract InstrumentsTest is Stack {
    address a = makeAddr("investor A");
    address b = makeAddr("investor B");
    address cashOnly = makeAddr("onboarded for cash only");
    address nobody = makeAddr("never onboarded");

    function setUp() public {
        _deployStack();
        _onboard(a, true);
        _onboard(b, true);
        _onboard(cashOnly, false);
        _credit(a, 1_000_000_00);
        _issueUnits(20);
    }

    // --- the note ---

    function test_unitsAndDecimals() public view {
        assertEq(Token(address(l.note)).decimals(), 0, "a balance is a count of units");
        assertEq(d.deposit.decimals(), 2, "the deposit is in cents");
        assertEq(Token(address(l.note)).name(), "N");
    }

    /// The term sheet is a claim on the note's own identity: its hash and where it is.
    function test_termSheetAnchoredOnTheNotesIdentity() public view {
        IIdentity id = IIdentity(Token(address(l.note)).onchainID());
        bytes32 claimId = keccak256(abi.encode(address(id), ClaimTopics.TERM_SHEET));
        (uint256 topic,, address issuer,, bytes memory data, string memory uri) = id.getClaim(claimId);
        assertEq(topic, ClaimTopics.TERM_SHEET);
        assertEq(issuer, address(id), "stated by the note about itself");
        (bytes32 hash, string memory location) = abi.decode(data, (bytes32, string));
        assertEq(hash, keccak256("term sheet"));
        assertEq(location, "ipfs://term-sheet");
        assertEq(uri, "ipfs://term-sheet");
    }

    function test_issueToInventoryThenPlace() public {
        assertEq(l.note.balanceOf(inventory), 20);
        _place(a, 5);
        assertEq(l.note.balanceOf(a), 5);
        assertEq(d.deposit.balanceOf(inventory), 5 * 100_000, "the Issuer is paid at par");
    }

    // --- one identity, claims by role ---

    /// A client's identity is created once; each registry reads it for its own claim.
    function test_oneIdentityServesBothAssets() public view {
        assertEq(address(l.identityRegistry.identity(a)), address(identityOf[a]));
        assertEq(address(d.depositRegistry.identity(a)), address(identityOf[a]));
        assertTrue(l.identityRegistry.isVerified(a), "the onboarding agent vouches for the note");
        assertTrue(d.depositRegistry.isVerified(a), "the bank vouches for the deposit");
        assertTrue(d.depositRegistry.isVerified(cashOnly));
        assertFalse(l.identityRegistry.isVerified(cashOnly), "no note claim, no note");
        assertFalse(l.identityRegistry.isVerified(nobody));
    }

    /// A claim lapses with no transaction: from its lapse, the client can neither receive nor
    /// send, and a fresh claim restores it.
    function test_aClaimLapsesWithoutATransaction() public {
        _place(a, 5);
        vm.warp(block.timestamp + claimLife);
        assertFalse(l.identityRegistry.isVerified(a));
        assertFalse(d.deposit.canReceive(a));
        vm.prank(inventory);
        vm.expectRevert();
        IERC20Like(address(l.note)).transfer(a, 1);
        _vouchNote(a);
        _vouchCash(a);
        assertTrue(l.identityRegistry.isVerified(a), "renewed by a fresh claim");
        assertTrue(d.deposit.canReceive(a));
    }

    /// A claim may not run longer than its issuer's maximum validity.
    function test_aClaimLongerThanTheMaximumIsInvalid() public {
        uint48 now_ = uint48(block.timestamp);
        bytes memory data = d.onboardingIssuer.claimData(now_, now_ + d.onboardingIssuer.maxValidity() + 1, 0);
        bytes memory sig = Onboarding.sign(ONBOARDING_KEY, identityOf[a], ClaimTopics.NOTE_ELIGIBLE, data);
        assertFalse(d.onboardingIssuer.isClaimValid(identityOf[a], ClaimTopics.NOTE_ELIGIBLE, sig, data));
        data = d.onboardingIssuer.claimData(now_ + 1, now_ + 30 days, 0);
        sig = Onboarding.sign(ONBOARDING_KEY, identityOf[a], ClaimTopics.NOTE_ELIGIBLE, data);
        assertFalse(d.onboardingIssuer.isClaimValid(identityOf[a], ClaimTopics.NOTE_ELIGIBLE, sig, data), "not issued yet");
    }

    /// Revoking a claim stops the client at once, for that asset only.
    function test_revocationStopsTransfersAtOnce() public {
        _place(a, 5);
        _revokeNote(a);
        assertFalse(l.identityRegistry.isVerified(a));
        assertTrue(d.deposit.canSend(a), "the bank's claim stands");
        vm.prank(inventory);
        vm.expectRevert();
        IERC20Like(address(l.note)).transfer(a, 1);
    }

    /// Only a claim signed by a key of the named issuer verifies; a stranger's is refused.
    function test_onlyTheIssuersKeysVouch() public {
        uint48 now_ = uint48(block.timestamp);
        bytes memory data = d.onboardingIssuer.claimData(now_, now_ + 30 days, 0);
        bytes memory forged = Onboarding.sign(0xBAD, identityOf[b], ClaimTopics.NOTE_ELIGIBLE, data);
        vm.prank(onboardingAgent);
        vm.expectRevert(Errors.InvalidClaim.selector);
        identityOf[b].addClaim(ClaimTopics.NOTE_ELIGIBLE, 1, address(d.onboardingIssuer), forged, data, "");
    }

    /// An institution the note does not trust cannot make a client eligible for it, even with a
    /// valid claim from its own issuer.
    function test_anUntrustedIssuerDoesNotVerify() public {
        uint256 strangerKey = 0x57A;
        ExpiringClaimIssuer stranger = new ExpiringClaimIssuer(vm.addr(strangerKey), 365 days);
        vm.prank(bank);
        Onboarding.consent(identityOf[cashOnly], vm.addr(strangerKey));
        vm.startPrank(vm.addr(strangerKey));
        Onboarding.vouch(stranger, strangerKey, identityOf[cashOnly], ClaimTopics.NOTE_ELIGIBLE, uint48(block.timestamp + 30 days), 0);
        vm.stopPrank();
        assertFalse(l.identityRegistry.isVerified(cashOnly));
    }

    /// The client's consent is a claim key on its identity: without it, an institution cannot
    /// write a claim there.
    function test_anInstitutionNeedsTheClientsConsent() public {
        uint48 now_ = uint48(block.timestamp);
        bytes memory data = d.onboardingIssuer.claimData(now_, now_ + 30 days, 0);
        bytes memory sig = Onboarding.sign(ONBOARDING_KEY, identityOf[cashOnly], ClaimTopics.NOTE_ELIGIBLE, data);
        vm.prank(onboardingAgent);
        vm.expectRevert(Errors.SenderDoesNotHaveClaimSignerKey.selector);
        identityOf[cashOnly].addClaim(ClaimTopics.NOTE_ELIGIBLE, 1, address(d.onboardingIssuer), sig, data, "");
    }

    /// Redemption burns for a holder whose note claim has lapsed by maturity.
    function test_redemptionBurnsForALapsedHolder() public {
        _place(a, 5);
        _credit(agent, 100_000_000_00);
        vm.prank(agent);
        IERC20Like(address(d.deposit)).approve(address(l.payingAgent), type(uint256).max);
        vm.warp(_obs(0).date);
        _determine(0, 10_500); // MER
        _revokeNote(a);
        vm.warp(_obs(0).paymentDate);
        vm.startPrank(agent);
        bytes32 id = l.payingAgent.open(0, PayingAgent.Kind.Redemption);
        address[] memory one = new address[](1);
        one[0] = a;
        l.payingAgent.pay(id, one);
        vm.stopPrank();
        assertEq(l.note.balanceOf(a), 0, "burned");
        assertEq(l.note.totalSupply(), 0);
    }

    // --- agents, each restricted (ADR 0085) ---

    function test_theIssuerMintsAndUnpausesOnly() public {
        vm.startPrank(inventory);
        vm.expectRevert();
        l.note.burn(inventory, 1);
        vm.expectRevert();
        l.note.forcedTransfer(inventory, a, 1);
        vm.expectRevert();
        l.note.freezePartialTokens(inventory, 1);
        vm.expectRevert();
        l.note.setAddressFrozen(a, true);
        l.note.mint(inventory, 1);
        vm.stopPrank();
    }

    function test_thePayingAgentBurnsAndPausesOnly() public {
        vm.startPrank(address(l.payingAgent));
        vm.expectRevert();
        l.note.mint(inventory, 1);
        vm.expectRevert();
        l.note.forcedTransfer(inventory, a, 1);
        vm.expectRevert();
        l.note.recoveryAddress(inventory, a, address(identityOf[a]));
        l.note.burn(inventory, 1);
        l.note.pause();
        vm.stopPrank();
    }

    // --- the deposit ---

    function test_creditAndDebitCarryTheirBooking() public {
        vm.expectEmit(true, true, false, true, address(d.gateway));
        emit IDepositGateway.Credited(b, 5_000_00, "booking-1");
        vm.prank(bank);
        d.gateway.credit(b, 5_000_00, "booking-1");
        vm.prank(bank);
        d.gateway.debit(b, 1_000_00, "booking-2");
        assertEq(d.deposit.balanceOf(b), 4_000_00);
        assertTrue(d.gateway.booked("booking-1"));
    }

    function test_aBookingCannotBeReplayed() public {
        vm.prank(bank);
        d.gateway.credit(b, 1, "booking-1");
        vm.prank(bank);
        vm.expectRevert(abi.encodeWithSelector(IDepositGateway.ReferenceUsed.selector, bytes32("booking-1")));
        d.gateway.credit(b, 1, "booking-1");
        vm.prank(bank);
        vm.expectRevert(IDepositGateway.ZeroReference.selector);
        d.gateway.credit(b, 1, bytes32(0));
    }

    function test_creditToAnAccountThatCannotReceiveReverts() public {
        vm.prank(bank);
        vm.expectRevert(abi.encodeWithSelector(IERC7943Fungible.ERC7943CannotReceive.selector, nobody));
        d.gateway.credit(nobody, 1, "booking-1");
    }

    function test_onlyTheGatewayCreatesDeposit() public {
        vm.prank(bank);
        vm.expectRevert();
        d.deposit.mint(bank, 1);
    }

    function test_debitCannotTakeTheFrozenPart() public {
        vm.prank(bank);
        d.gateway.credit(b, 100, "booking-1");
        vm.prank(bank);
        d.deposit.setFrozenTokens(b, 60);
        vm.prank(bank);
        vm.expectRevert(abi.encodeWithSelector(IERC7943Fungible.ERC7943InsufficientUnfrozenBalance.selector, b, 41, 40));
        d.gateway.debit(b, 41, "booking-2");
        vm.prank(bank);
        d.gateway.debit(b, 40, "booking-3");
        assertEq(d.deposit.balanceOf(b), 60);
    }

    /// Sender, receiver and spender are all checked: an allowance to an account the bank has not
    /// accepted is refused, and so is a move by one.
    function test_theSpenderIsChecked() public {
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(DepositToken.NotEligible.selector, nobody));
        IERC20Like(address(d.deposit)).approve(nobody, 1);

        vm.prank(a);
        IERC20Like(address(d.deposit)).approve(cashOnly, 1_00);
        _revokeCash(cashOnly);
        vm.prank(cashOnly);
        vm.expectRevert(abi.encodeWithSelector(DepositToken.NotEligible.selector, cashOnly));
        IERC20From(address(d.deposit)).transferFrom(a, b, 1_00);
    }

    /// Contracts are eligible by the bank's allowlist, not by an identity.
    function test_contractsAreAllowlisted() public view {
        assertTrue(d.deposit.allowlisted(address(l.payingAgent)));
        assertTrue(d.deposit.canReceive(address(l.settlement)));
        assertFalse(d.depositRegistry.contains(address(l.settlement)), "no identity");
    }

    /// A forced transfer never delivers to an account that cannot receive, and takes from the
    /// frozen part only what the free part lacks.
    function test_forcedTransfer() public {
        d.deposit.grantRole(d.deposit.FORCED_TRANSFER_ROLE(), address(this)); // the admin until the ceremony
        vm.prank(bank);
        d.gateway.credit(b, 100, "booking-1");
        vm.prank(bank);
        d.deposit.setFrozenTokens(b, 60);
        vm.expectRevert(abi.encodeWithSelector(IERC7943Fungible.ERC7943CannotReceive.selector, nobody));
        d.deposit.forcedTransfer(b, nobody, 10);
        d.deposit.forcedTransfer(b, a, 70);
        assertEq(d.deposit.balanceOf(b), 30);
        assertEq(d.deposit.getFrozenTokens(b), 30, "ten taken from the frozen part");
    }

    function test_pausingStopsTransfers() public {
        vm.prank(bank);
        d.deposit.pause();
        vm.prank(a);
        vm.expectRevert();
        IERC20Like(address(d.deposit)).transfer(b, 1);
        assertFalse(d.deposit.canTransfer(a, b, 1));
    }
}
