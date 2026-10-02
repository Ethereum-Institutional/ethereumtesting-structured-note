// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {Script, console2} from "forge-std/Script.sol";
import {GovernanceController} from "../src/GovernanceController.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {StructuredNote} from "../src/StructuredNote.sol";
import {TokenizedDeposit} from "../src/TokenizedDeposit.sol";
import {DepositGateway} from "../src/DepositGateway.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {Instruments} from "./Instruments.sol";
import {Lifecycle} from "./Lifecycle.sol";
import {Governance} from "./Governance.sol";

interface IWalletFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

/**
 * The governance ceremony on the local stack (ADRs 0016, 0021 to 0025).
 *
 * Creates four real multi-signature wallets from the canonical deployment that
 * ops/setup-multisig.sh installs: the Agent's governance wallet, the Issuer's, the co-signing
 * institution's, and the Agent's servicing wallet. Each has three signers and a threshold of
 * two, so any two institutions together require four signatures. Signers are derived at indices
 * 10 to 21 from the local node's published test mnemonic on the local node, and from the
 * network's own mnemonic (WALLET_MNEMONIC) anywhere else (ADR 0051).
 *
 * Delays are compressed for the local stack, as ADR 0023 allows for the PoC: one hour for Tier 2
 * and four hours for recovery. The targets are 72 hours and 14 days. Both are recorded in the
 * manifest so that neither is mistaken for the other.
 *
 * The ceremony ends with the deployer's renunciation. Run from instruments/ after IssueNote.
 */
contract Ceremony is Script {
    string constant MNEMONIC = "test test test test test test test test test test test junk";

    address constant WALLET_SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address constant WALLET_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address constant FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;

    uint48 constant LOCAL_TIER2_DELAY = 1 hours;
    uint48 constant LOCAL_RECOVERY_DELAY = 4 hours;
    uint48 constant TARGET_TIER2_DELAY = 72 hours;
    uint48 constant TARGET_RECOVERY_DELAY = 14 days;
    /// @dev A queued Tier 2 proposal expires this long after it becomes executable (S-24, ADR 0082).
    uint48 constant LOCAL_EXECUTION_WINDOW = 1 days;
    uint48 constant TARGET_EXECUTION_WINDOW = 7 days;

    struct Wallets {
        address agentGov;
        address issuerGov;
        address cosigner;
        address servicing;
    }

    function run() external {
        uint256 deployerPk = vm.envUint("ISSUER_PK");
        (Instruments.Deployed memory d, Lifecycle.Issued memory l) = _load();

        vm.startBroadcast(deployerPk);
        // Salted with the note, so each deployment of a network gets its own wallets, by the same
        // signers: a wallet's address follows from its owners and salt alone.
        Wallets memory w = Wallets(_wallet(10, _salt(d, 1)), _wallet(13, _salt(d, 2)), _wallet(16, _salt(d, 3)), _wallet(19, _salt(d, 4)));
        GovernanceController g = Governance.ceremony(d, l, _config(w, vm.addr(deployerPk)));
        vm.stopBroadcast();

        console2.log("controller             :", address(g));
        console2.log("Agent governance wallet:", w.agentGov);
        console2.log("servicing wallet       :", w.servicing);
        _record(g, w);
    }

    function _load() private view returns (Instruments.Deployed memory d, Lifecycle.Issued memory l) {
        string memory j = vm.readFile(_manifest());
        d.registry = IdentityRegistry(vm.parseJsonAddress(j, ".instruments.registry"));
        d.note = StructuredNote(vm.parseJsonAddress(j, ".instruments.note"));
        d.deposit = TokenizedDeposit(vm.parseJsonAddress(j, ".instruments.deposit"));
        d.gateway = DepositGateway(vm.parseJsonAddress(j, ".instruments.gateway"));
        l.payingAgent = PayingAgent(vm.parseJsonAddress(j, ".lifecycle.payingAgent"));
    }

    function _config(Wallets memory w, address deployer) private view returns (Governance.Config memory) {
        address[] memory institutions = new address[](3);
        institutions[0] = w.agentGov;
        institutions[1] = w.issuerGov;
        institutions[2] = w.cosigner;
        return Governance.Config({
            deployer: deployer,
            interimAgent: vm.addr(vm.envUint("AGENT_PK")),
            institutions: institutions,
            agentGovernance: w.agentGov,
            servicingWallet: w.servicing,
            minInstitutions: 2,
            minSignatures: 4,
            tier2Delay: LOCAL_TIER2_DELAY,
            recoveryDelay: LOCAL_RECOVERY_DELAY,
            executionWindow: LOCAL_EXECUTION_WINDOW,
            venue: _venue()
        });
    }

    /// The venue, handed over in the same ceremony.
    function _venue() private view returns (Governance.Venue memory) {
        string memory j = vm.readFile(_manifest());
        return Governance.Venue({
            checker: vm.parseJsonAddress(j, ".venue.allowlistChecker"),
            adapter: vm.parseJsonAddress(j, ".venue.permissionsAdapter"),
            credentialGate: vm.parseJsonAddress(j, ".venue.credentialGate")
        });
    }

    function _record(GovernanceController g, Wallets memory w) private {
        string memory o = "governance";
        vm.serializeAddress(o, "controller", address(g));
        vm.serializeAddress(o, "walletFactory", WALLET_FACTORY);
        vm.serializeAddress(o, "agentGovernance", w.agentGov);
        vm.serializeAddress(o, "issuerGovernance", w.issuerGov);
        vm.serializeAddress(o, "cosigner", w.cosigner);
        vm.serializeAddress(o, "servicingWallet", w.servicing);
        vm.serializeUint(o, "firstSignerIndex", 10);
        vm.serializeUint(o, "minInstitutions", 2);
        vm.serializeUint(o, "minSignatures", 4);
        vm.serializeUint(o, "tier2Delay", LOCAL_TIER2_DELAY);
        vm.serializeUint(o, "recoveryDelay", LOCAL_RECOVERY_DELAY);
        vm.serializeUint(o, "targetTier2Delay", TARGET_TIER2_DELAY);
        vm.serializeUint(o, "executionWindow", LOCAL_EXECUTION_WINDOW);
        vm.serializeUint(o, "targetExecutionWindow", TARGET_EXECUTION_WINDOW);
        vm.writeJson(vm.serializeUint(o, "targetRecoveryDelay", TARGET_RECOVERY_DELAY), _manifest(), ".governance");
    }

    /// A 2-of-3 wallet whose signers are the mnemonic's keys from `firstIndex`.
    function _wallet(uint32 firstIndex, uint256 salt) private returns (address) {
        address[] memory owners = new address[](3);
        for (uint32 k = 0; k < 3; ++k) {
            owners[k] = vm.addr(vm.deriveKey(_mnemonic(), firstIndex + k));
        }
        bytes memory setup = abi.encodeWithSignature(
            "setup(address[],uint256,address,bytes,address,address,uint256,address)",
            owners,
            2,
            address(0),
            "",
            FALLBACK_HANDLER,
            address(0),
            0,
            address(0)
        );
        return IWalletFactory(WALLET_FACTORY).createProxyWithNonce(WALLET_SINGLETON, setup, salt);
    }

    function _salt(Instruments.Deployed memory d, uint256 k) private pure returns (uint256) {
        return uint256(keccak256(abi.encode(address(d.note), k)));
    }

    function _mnemonic() private view returns (string memory) {
        return block.chainid == 31337 ? MNEMONIC : vm.envString("WALLET_MNEMONIC");
    }

    function _manifest() private view returns (string memory) {
        return string.concat("../", vm.envOr("MANIFEST", string("ops/addresses.json")));
    }
}
