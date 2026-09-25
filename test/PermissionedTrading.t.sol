// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Test.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {PermissionFlags} from "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";

import {PermissionedSwapRouter} from "../contracts/PermissionedSwapRouter.sol";
import {VenueTestBase} from "./VenueTestBase.sol";

interface IDepositGateway {
    function credit(address account, uint256 amount, bytes32 bookingRef) external;
}

interface IProtocolRevocations {
    function revoke(string calldata did, bytes32 credentialId) external;
}

interface IProtocolIssuers {
    function deactivateIssuer(string calldata did) external;
}

/**
 * The conversion pool's controls, each shown binding (overview S-27 to S-29; ADRs 0030 to 0039).
 * Every test states a control and shows the transaction succeeding or failing for the right
 * reason; every refusal has a positive control.
 *
 *   ./ops/reset.sh && forge test --fork-url http://127.0.0.1:8545 -vv
 */
contract PermissionedTradingTest is VenueTestBase {
    address investorA; // entity, credentialed
    address investorB; // natural person, credentialed
    address investorC; // onboarded to the deposit, no credential
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

    /// A credentialed entity converts the payment token into the deposit, near par.
    function test_credentialedEntity_convertsIntoTheDeposit() public {
        uint256 before = deposit.balanceOf(investorA);
        _convert(investorA, SWAP_IN, true);
        uint256 gained = deposit.balanceOf(investorA) - before;
        console2.log("investor A received deposit, cents:", gained);
        // 10,000 in, less the 0.05% fee and the price impact, inside the band around par.
        assertGt(gained, 9_980_00, "near par");
        assertLt(gained, 10_000_00, "a spread is paid");
    }

    /// A credentialed natural person converts the deposit back into the payment token.
    function test_credentialedPerson_convertsOutOfTheDeposit() public {
        uint256 before = payment.balanceOf(investorB);
        _convert(investorB, 5_000_00, false);
        assertGt(payment.balanceOf(investorB) - before, 4_990e6, "near par");
    }

    // --- S-28: the perimeter sits at the wallet ---

    /// Onboarded to the deposit but holding no credential: the deposit would accept the wallet,
    /// the pool does not. Admitting it is the only change, and then it converts.
    function test_noCredential_refusedByThePoolThoughTheDepositAccepts() public {
        assertTrue(deposit.canReceive(investorC) && deposit.canSend(investorC), "the deposit accepts investor C");
        assertFalse(gate.isAllowed(investorC), "no credential");
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

    /// Only the Deposit Agent provides liquidity; the same plan is refused for a credentialed
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

    /// The protocol revokes a credential; anyone voids the grant; the wallet stops at once.
    function test_protocolRevocation_voidedByAnyone_stopsTheWallet() public {
        _convert(investorB, SWAP_IN, true);
        string memory did = vm.parseJsonString(manifest, ".credentialProtocol.issuerDid");
        bytes32 credential = keccak256(abi.encodePacked("CRD-0003", "/primary"));
        address operator = _issuerOperator(did);
        _as(operator);
        IProtocolRevocations(_addr(".credentialProtocol.revocations")).revoke(did, credential);

        assertTrue(gate.isAllowed(investorB), "not until voided");
        _as(makeAddr("anyone"));
        gate.void(investorB);
        assertFalse(gate.isAllowed(investorB));
        assertTrue(_may(investorA, PermissionFlags.SWAP_ALLOWED), "others unaffected");
        _expectConvertReverts(investorB);
    }

    /// Deactivating the issuer in the protocol suspends the whole pool, by anyone's call.
    function test_issuerDeactivation_suspendsThePool() public {
        string memory did = vm.parseJsonString(manifest, ".credentialProtocol.issuerDid");
        _as(_protocolRegistrar());
        IProtocolIssuers(_addr(".credentialProtocol.issuers")).deactivateIssuer(did);
        gate.suspendIssuer();
        _expectConvertReverts(investorA);
        _expectConvertReverts(depositAgent);
    }

    /// Supervisory withdrawal of pool access is Tier 1, by the Agent's governance wallet.
    function test_tier1WithdrawalOfPoolAccess() public {
        _as(agentGovernance);
        controller.withdrawPoolAccess(investorA, "Pool access withdrawn pending review of a screening alert");
        assertFalse(gate.isAllowed(investorA));
        _expectConvertReverts(investorA);
        _convert(investorB, SWAP_IN, true); // others unaffected
    }

    /// Withdrawing the registry grant stops the pool at once, with no venue action (ADR 0004).
    function test_registryWithdrawal_stopsThePool() public {
        assertTrue(gate.isAllowed(investorA), "the credential is untouched");
        _as(agentGovernance);
        controller.withdrawGrant(investorA, "Sanctions designation");
        assertTrue(checker.checkAllowlist(investorA, address(deposit)) == PermissionFlags.NONE);
        _expectConvertReverts(investorA);
    }

    /// A deposit freeze by the Deposit Agent stops the wallet.
    function test_depositFreeze_stopsTheWallet() public {
        _as(depositAgent);
        deposit.setAddressFrozen(investorA, true);
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

    /// A grant lapses without any transaction.
    function test_grantLapses() public {
        uint40 expiresAt = gate.grantOf(investorA).expiresAt;
        vm.warp(expiresAt - 1);
        _convert(investorA, SWAP_IN, true);
        vm.warp(expiresAt);
        _expectConvertReverts(investorA);
    }

    // --- fail closed ---

    /// A credential gate that cannot answer denies everyone.
    function test_unanswerableCredentialGate_deniesEveryone() public {
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
        assertTrue(gate.hasRole(0x00, address(controller)), "gate admin");
        assertTrue(gate.hasRole(gate.SUPERVISOR_ROLE(), address(controller)), "gate supervisor");
        assertFalse(gate.hasRole(0x00, _addr(".parties.issuer")), "the deployer holds nothing");
        assertEq(controller.credentialGate(), address(gate));
    }

    // --- helpers ---

    function _issuerOperator(string memory did) internal view returns (address operator) {
        (bool ok, bytes memory ret) =
            _addr(".credentialProtocol.issuers").staticcall(abi.encodeWithSignature("getChainOperator(string)", did));
        require(ok, "no operator");
        operator = abi.decode(ret, (address));
    }

    /// The protocol's registrar. Locally the deployer initialised the registry; on a fork, whoever
    /// holds the role there.
    function _protocolRegistrar() internal view returns (address) {
        return vm.envOr("PROTOCOL_REGISTRAR", _addr(".parties.issuer"));
    }
}
