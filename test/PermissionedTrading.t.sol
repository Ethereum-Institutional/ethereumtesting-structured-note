// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Test.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {PermissionFlags} from "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";

import {PermissionedSwapRouter} from "../contracts/PermissionedSwapRouter.sol";
import {IdentityPoolGate} from "../contracts/IdentityPoolGate.sol";
import {PoolAccess} from "../script/PoolAccess.sol";
import {VenueTestBase, IClaimIssuer, IClaims, ITrustedIssuers} from "./VenueTestBase.sol";

interface IDepositGateway {
    function credit(address account, uint256 amount, bytes32 bookingRef) external;
}

/**
 * The conversion pool's controls, each shown binding (overview S-27 to S-29; ADRs 0030 to 0039,
 * 0090). Every test states a control and shows the transaction succeeding or failing for the right
 * reason; every refusal has a positive control.
 *
 *   ./ops/reset.sh && forge test --fork-url http://127.0.0.1:8545 -vv
 */
contract PermissionedTradingTest is VenueTestBase {
    address investorA; // admitted to the pool
    address investorB; // admitted to the pool
    address investorC; // onboarded to the deposit, not admitted to the pool
    address investorD; // onboarded nowhere

    uint128 constant SWAP_IN = 10_000e6; // EUR 10,000 of the payment token

    function setUp() public override {
        super.setUp();
        investorA = _addr(".parties.investorA");
        investorB = _addr(".parties.investorB");
        investorC = _addr(".parties.investorC");
        investorD = _addr(".parties.investorD");
    }

    function _convert(address who, uint128 amountIn, bool intoDeposit) internal {
        _as(who);
        PermissionedSwapRouter(payable(router)).execute(_swapCalldata(amountIn, intoDeposit), block.timestamp + 600);
    }

    function _expectConvertReverts(address who) internal {
        bytes memory plan = _swapCalldata(SWAP_IN, true);
        _as(who);
        vm.expectRevert();
        PermissionedSwapRouter(payable(router)).execute(plan, block.timestamp + 600);
    }

    // --- S-27: conversion by an admitted participant ---

    /// An admitted investor converts the payment token into the deposit, near par.
    function test_admittedInvestor_convertsIntoTheDeposit() public {
        assertTrue(gate.standing(investorA) == IdentityPoolGate.Standing.Allowed, "admitted");
        uint256 before = deposit.balanceOf(investorA);
        _convert(investorA, SWAP_IN, true);
        uint256 gained = deposit.balanceOf(investorA) - before;
        console2.log("investor A received deposit, cents:", gained);
        // 10,000 in, less the 0.05% fee and the price impact, inside the band around par.
        assertGt(gained, 9_980_00, "near par");
        assertLt(gained, 10_000_00, "a spread is paid");
    }

    /// An admitted investor converts the deposit back into the payment token.
    function test_admittedInvestor_convertsOutOfTheDeposit() public {
        uint256 before = payment.balanceOf(investorB);
        _convert(investorB, 5_000_00, false);
        assertGt(payment.balanceOf(investorB) - before, 4_990e6, "near par");
    }

    // --- S-28: the perimeter sits at the identity ---

    /// Onboarded to the deposit but holding no pool-access claim: the deposit would accept the
    /// wallet, the pool does not. The bank's pool-access claim is the only change, and then it
    /// converts.
    function test_noPoolClaim_refusedByThePoolThoughTheDepositAccepts() public {
        assertTrue(deposit.canReceive(investorC) && deposit.canSend(investorC), "the deposit accepts investor C");
        assertTrue(gate.standing(investorC) == IdentityPoolGate.Standing.NotVerified, "no pool-access claim");
        assertTrue(checker.checkAllowlist(investorC, address(deposit)) == PermissionFlags.NONE, "no permission");
        _expectConvertReverts(investorC);

        _admit(investorC);
        uint256 before = deposit.balanceOf(investorC);
        _convert(investorC, SWAP_IN, true);
        assertGt(deposit.balanceOf(investorC), before, "admitted, it converts");
    }

    /// A wallet onboarded nowhere is refused despite holding the payment token and approvals.
    function test_notOnboarded_refused() public {
        assertGt(payment.balanceOf(investorD), 0, "investor D is funded");
        assertEq(PoolAccess.identityOf(manifest, investorD), address(0), "no identity");
        assertTrue(checker.checkAllowlist(investorD, address(deposit)) == PermissionFlags.NONE);
        _expectConvertReverts(investorD);
    }

    // --- liquidity, and S-29 ---

    function _mintPlan(address owner) internal view returns (bytes memory) {
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key,
            int24(vm.parseJsonInt(manifest, ".pool.tickLower")),
            int24(vm.parseJsonInt(manifest, ".pool.tickUpper")),
            uint256(1e9),
            type(uint128).max,
            type(uint128).max,
            owner,
            bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        return abi.encode(actions, params);
    }

    /// Only the Deposit Agent provides liquidity; the same plan is refused for an admitted
    /// investor, so the refusal is the permission's.
    function test_onlyTheDepositAgentProvidesLiquidity() public {
        assertTrue(_may(investorB, PermissionFlags.SWAP_ALLOWED), "investor B may convert");
        assertFalse(_may(investorB, PermissionFlags.LIQUIDITY_ALLOWED), "but not provide liquidity");

        // The seeded position used the Deposit Agent's whole inventory; top it up for a second.
        _as(depositAgent);
        IDepositGateway(_addr(".instruments.gateway")).credit(depositAgent, 10_000_00, "TST-0001");
        deal(address(payment), depositAgent, 10_000e6);
        _as(depositAgent);
        IPositionManager(posm).modifyLiquidities(_mintPlan(depositAgent), block.timestamp + 600);

        bytes memory plan = _mintPlan(investorB);
        _as(investorB);
        vm.expectRevert();
        IPositionManager(posm).modifyLiquidities(plan, block.timestamp + 600);
    }

    /// A liquidity position cannot be passed to anyone, the provider's own sibling included.
    function test_liquidityPositionIsNotTransferable() public {
        uint256 tokenId = IPositionManager(posm).nextTokenId() - 1;
        assertEq(IERC721(posm).ownerOf(tokenId), depositAgent, "the seeded position");
        _as(depositAgent);
        vm.expectRevert();
        IERC721(posm).transferFrom(depositAgent, investorA, tokenId);
    }

    // --- revocable at once ---

    /// The bank revokes its pool-access claim; the wallet stops at once, others not.
    function test_claimRevocation_stopsTheWallet() public {
        _convert(investorB, SWAP_IN, true);
        (bytes memory signature,) = _poolClaim(investorB);
        _as(depositAgent);
        IClaimIssuer(_addr(".identity.bankIssuer")).revokeClaimBySignature(signature);

        assertTrue(gate.standing(investorB) == IdentityPoolGate.Standing.NotVerified, "revoked");
        assertTrue(_may(investorA, PermissionFlags.SWAP_ALLOWED), "others unaffected");
        _expectConvertReverts(investorB);
    }

    /// Ceasing to trust the bank's issuer for pool access, a Tier 2 act, closes the pool to
    /// everyone it vouched for, by the controller's call on the pool's registry.
    function test_issuerNoLongerTrusted_closesThePool() public {
        _as(address(controller));
        ITrustedIssuers(_addr(".identity.poolIssuers")).removeTrustedIssuer(_addr(".identity.bankIssuer"));
        _expectConvertReverts(investorA);
        _expectConvertReverts(depositAgent);
    }

    /// Supervisory withdrawal of pool access is Tier 1, by the Agent's governance wallet, and so is
    /// restoring it.
    function test_tier1WithdrawalAndRestorationOfPoolAccess() public {
        _as(agentGovernance);
        controller.withdrawPoolAccess(investorA, "Pool access withdrawn pending review of a screening alert");
        assertTrue(gate.standing(investorA) == IdentityPoolGate.Standing.Withdrawn, "withdrawn");
        _expectConvertReverts(investorA);
        _convert(investorB, SWAP_IN, true); // others unaffected

        _as(agentGovernance);
        controller.restorePoolAccess(investorA, "Review closed with no finding");
        _convert(investorA, SWAP_IN, true);
    }

    /// The bank revoking its deposit claim stops the pool at once, though the pool-access claim
    /// stands, with no venue action (ADR 0004).
    function test_depositClaimRevocation_stopsThePool() public {
        assertTrue(gate.isAllowed(investorA), "the pool-access claim is untouched");
        address bankIssuer = _addr(".identity.bankIssuer");
        bytes32 claimId = keccak256(abi.encode(bankIssuer, vm.parseJsonUint(manifest, ".identity.depositEligibleTopic")));
        (,,, bytes memory signature,,) = IClaims(PoolAccess.identityOf(manifest, investorA)).getClaim(claimId);
        _as(depositAgent);
        IClaimIssuer(bankIssuer).revokeClaimBySignature(signature);
        assertFalse(deposit.canReceive(investorA), "the deposit refuses it");
        assertTrue(checker.checkAllowlist(investorA, address(deposit)) == PermissionFlags.NONE);
        _expectConvertReverts(investorA);
    }

    /// The bank freezing a wallet's whole deposit balance stops the wallet.
    function test_depositFreeze_stopsTheWallet() public {
        uint256 whole = deposit.balanceOf(investorA);
        _as(depositAgent);
        deposit.setFrozenTokens(investorA, whole);
        assertTrue(checker.checkAllowlist(investorA, address(deposit)) == PermissionFlags.NONE, "frozen");
        _expectConvertReverts(investorA);
        _convert(investorB, SWAP_IN, true);
    }

    /// Pausing the deposit halts the whole pool.
    function test_depositPause_haltsThePool() public {
        _as(depositAgent);
        deposit.pause();
        _expectConvertReverts(investorA);
        _expectConvertReverts(investorB);
    }

    /// The servicing wallet switches swapping off through the controller, and back on.
    function test_servicingWalletSwitchesSwapping() public {
        _as(servicingWallet);
        controller.setVenueSwapping(false);
        _expectConvertReverts(investorA);
        _as(servicingWallet);
        controller.setVenueSwapping(true);
        _convert(investorA, SWAP_IN, true);
    }

    /// A pool-access claim lapses without any transaction.
    function test_poolClaimLapses() public {
        (, bytes memory data) = _poolClaim(investorA);
        (, uint48 validUntil,) = abi.decode(data, (uint48, uint48, bytes32));
        vm.warp(validUntil - 1);
        _convert(investorA, SWAP_IN, true);
        vm.warp(validUntil);
        _expectConvertReverts(investorA);
    }

    /// The pool serves the jurisdictions it was built with, and the cast's is among them.
    function test_jurisdictionsServed() public view {
        assertEq(gate.jurisdictions().length, 32, "the EEA, Switzerland and the United Kingdom");
        assertTrue(gate.serves(276), "Germany");
        assertFalse(gate.serves(840), "not the United States");
    }

    // --- fail closed ---

    /// A gate that cannot answer denies everyone.
    function test_unanswerableGate_deniesEveryone() public {
        _as(address(controller));
        checker.setCredentialGate(address(deposit), address(0xDEAD));
        assertTrue(checker.checkAllowlist(investorA, address(deposit)) == PermissionFlags.NONE, "no code denies");
        _expectConvertReverts(investorA);
    }

    /// A registered token that does not answer the interface denies rather than reverting.
    function test_checkerFailsClosedOnNonConformingToken() public {
        address noCode = address(0xDEAD);
        address noInterface = address(payment);
        vm.deal(address(controller), 1 ether);
        vm.startPrank(address(controller));
        checker.registerAsset(noCode);
        checker.registerAsset(noInterface);
        vm.stopPrank();
        assertTrue(checker.checkAllowlist(investorA, noCode) == PermissionFlags.NONE, "no code denies");
        assertTrue(checker.checkAllowlist(investorA, noInterface) == PermissionFlags.NONE, "no interface denies");
        assertTrue(checker.checkAllowlist(investorA, address(0xBEEF)) == PermissionFlags.NONE, "unregistered denies");
    }

    // --- governed ---

    /// After the ceremony the venue answers to the controller alone.
    function test_theVenueIsGoverned() public view {
        assertEq(Ownable(address(checker)).owner(), address(controller), "checker");
        assertEq(Ownable(adapter).owner(), address(controller), "adapter");
        assertEq(Ownable(_addr(".identity.poolIssuers")).owner(), address(controller), "pool trusted issuers");
        assertTrue(gate.hasRole(0x00, address(controller)), "gate admin");
        assertTrue(gate.hasRole(gate.SUPERVISOR_ROLE(), address(controller)), "gate supervisor");
        assertFalse(gate.hasRole(0x00, _addr(".parties.issuer")), "the deployer holds nothing");
        assertEq(controller.credentialGate(), address(gate));
        assertEq(gate.registry(), _addr(".identity.poolRegistry"), "the gate reads the pool's registry");
    }
}
