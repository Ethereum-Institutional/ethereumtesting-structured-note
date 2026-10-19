// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {GovernanceController} from "../src/GovernanceController.sol";
import {INote, IOwnable2Step} from "../src/interfaces/INote.sol";
import {ClaimTopics} from "../src/claims/ClaimTopics.sol";

interface ITrusted {
    function hasClaimTopic(address issuer, uint256 topic) external view returns (bool);
}

interface IWallet {
    function nonce() external view returns (uint256);
    function getThreshold() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 nonce
    ) external view returns (bytes32);
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool);
}

/**
 * Governance through the real multi-signature wallets on the local stack (ADR 0024). Every act
 * is signed by two of the wallet's three signers and executed by the wallet itself.
 *
 *   ./ops/reset.sh && (cd instruments && FOUNDRY_PROFILE=fork forge test --fork-url http://127.0.0.1:8545)
 */
contract WalletsTest is Test {
    string constant MNEMONIC = "test test test test test test test test test test test junk";

    string manifest;
    GovernanceController g;
    INote note;

    function setUp() public {
        manifest = vm.readFile("../ops/addresses.json");
        g = GovernanceController(vm.parseJsonAddress(manifest, ".governance.controller"));
        note = INote(vm.parseJsonAddress(manifest, ".instruments.note"));
    }

    /// Two of the wallet's signers sign the wallet transaction; the first signer submits it.
    function _exec(address wallet, uint32 firstSigner, bytes memory data) internal {
        IWallet w = IWallet(wallet);
        bytes32 h = w.getTransactionHash(address(g), 0, data, 0, 0, 0, 0, address(0), address(0), w.nonce());
        (bytes memory signatures, address submitter) = _sign(h, firstSigner);
        vm.prank(submitter);
        w.execTransaction(address(g), 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures);
    }

    /// The wallet requires signatures ordered by signer address.
    function _sign(bytes32 h, uint32 firstSigner) internal pure returns (bytes memory, address) {
        uint256 k1 = vm.deriveKey(MNEMONIC, firstSigner);
        uint256 k2 = vm.deriveKey(MNEMONIC, firstSigner + 1);
        if (vm.addr(k1) > vm.addr(k2)) (k1, k2) = (k2, k1);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(k1, h);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(k2, h);
        return (abi.encodePacked(r1, s1, v1, r2, s2, v2), vm.addr(k1));
    }

    function test_theWalletsAreRealAndTwoOfThree() public view {
        address[3] memory inst = [
            vm.parseJsonAddress(manifest, ".governance.agentGovernance"),
            vm.parseJsonAddress(manifest, ".governance.issuerGovernance"),
            vm.parseJsonAddress(manifest, ".governance.cosigner")
        ];
        for (uint256 k; k < 3; ++k) {
            assertEq(IWallet(inst[k]).getThreshold(), 2);
            assertEq(IWallet(inst[k]).getOwners().length, 3);
            assertTrue(g.isInstitution(inst[k]));
        }
    }

    /// Tier 1 through the Agent's governance wallet.
    function test_tier1ThroughTheRealWallet() public {
        address a = vm.parseJsonAddress(manifest, ".parties.investorA");
        address b = vm.parseJsonAddress(manifest, ".parties.investorB");
        uint256 before = note.balanceOf(b);
        _exec(
            vm.parseJsonAddress(manifest, ".governance.agentGovernance"),
            10,
            abi.encodeCall(GovernanceController.correctRegister, (a, b, 1, "Register correction, local rehearsal"))
        );
        assertEq(note.balanceOf(b), before + 1);
    }

    /// Tier 2: proposed by one institution's wallet, approved by another's, executed after the delay.
    function test_tier2ThroughTheRealWallets() public {
        address dealer = makeAddr("a further onboarding agent's claim issuer");
        uint256 id = g.proposalCount() + 1;
        _exec(
            vm.parseJsonAddress(manifest, ".governance.agentGovernance"),
            10,
            abi.encodeCall(GovernanceController.proposeSetTrustedIssuer, (dealer, _noteTopic(), "Dealer appointed"))
        );
        (uint256 inst, uint256 sigs) = g.approvals(id);
        assertEq(inst, 1);
        assertEq(sigs, 2);
        _exec(
            vm.parseJsonAddress(manifest, ".governance.issuerGovernance"),
            13,
            abi.encodeCall(GovernanceController.approve, (id))
        );
        (inst, sigs) = g.approvals(id);
        assertEq(inst, 2);
        assertEq(sigs, 4, "two institutions, two signatures each");
        vm.warp(g.proposal(id).readyAt);
        g.execute(id);
        assertTrue(ITrusted(vm.parseJsonAddress(manifest, ".noteSuite.trustedIssuers")).hasClaimTopic(dealer, ClaimTopics.NOTE_ELIGIBLE));
    }

    function _noteTopic() internal pure returns (uint256[] memory topics) {
        topics = new uint256[](1);
        topics[0] = ClaimTopics.NOTE_ELIGIBLE;
    }

    /// The deployer renounced everything (the overview requires it, verified under test).
    function test_theDeployerRenounced() public view {
        address deployer = vm.parseJsonAddress(manifest, ".parties.issuer");
        assertEq(IOwnable2Step(address(note)).owner(), address(g));
        assertFalse(note.isAgent(deployer));
    }
}
