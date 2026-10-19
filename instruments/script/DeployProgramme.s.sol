// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {Scaffolding} from "./Scaffolding.sol";
import {Programme} from "./Programme.sol";
import {Manifest} from "./Manifest.sol";

interface IWalletFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

/**
 * The note programme: the institutions' multi-signature wallets, created once for the
 * deployment, then the sanctions module, the governance controller and the note factory.
 *
 * Four wallets from the canonical deployment ops/setup-multisig.sh installs: the Agent's
 * governance wallet, the Issuer's, the co-signing institution's, and the Agent's servicing wallet.
 * Each has three signers and a threshold of two, so any two institutions together require four
 * signatures. Signers are derived at indices 10 to 21 from the local node's published mnemonic on
 * the local node, and from the network's own mnemonic (WALLET_MNEMONIC) anywhere else.
 *
 * The programme's roles start as: the servicing wallet; the Calculation Agent's key; the Agent's
 * key as the funder of every distribution. The Issuer's wallet owns the note factory.
 *
 * Delays are compressed for the local stack, as the PoC allows: one hour for Tier 2 and four hours
 * for recovery, against targets of 72 hours and 14 days; both are recorded in the manifest.
 *
 * Run from instruments/ after the scaffolding, the venue and custody, and before any note.
 */
contract DeployProgramme is Script {
    string constant MNEMONIC = "test test test test test test test test test test test junk";

    address constant WALLET_SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address constant WALLET_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address constant FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;

    uint48 constant LOCAL_TIER2_DELAY = 1 hours;
    uint48 constant LOCAL_RECOVERY_DELAY = 4 hours;
    uint48 constant TARGET_TIER2_DELAY = 72 hours;
    uint48 constant TARGET_RECOVERY_DELAY = 14 days;
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
        string memory j = vm.readFile(_manifest());
        Scaffolding.Deployed memory d = Manifest.scaffolding(j);

        vm.startBroadcast(deployerPk);
        // Salted with the deployment's identity storage, so each deployment has its own wallets,
        // by the same signers: a wallet's address follows from its owners and salt alone.
        uint256 base = uint256(uint160(address(d.identities)));
        Wallets memory w =
            Wallets(_wallet(10, base + 1), _wallet(13, base + 2), _wallet(16, base + 3), _wallet(19, base + 4));
        Programme.Deployed memory p = Programme.deploy(d, _config(w, vm.addr(deployerPk), j));
        vm.stopBroadcast();

        console2.log("controller             :", address(p.controller));
        console2.log("note factory           :", address(p.factory));
        console2.log("Issuer's wallet        :", w.issuerGov);
        _record(p, w);
    }

    function _config(Wallets memory w, address deployer, string memory j) private view returns (Programme.Config memory) {
        address[] memory institutions = new address[](3);
        institutions[0] = w.agentGov;
        institutions[1] = w.issuerGov;
        institutions[2] = w.cosigner;
        return Programme.Config({
            deployer: deployer,
            issuerWallet: w.issuerGov,
            institutions: institutions,
            agentGovernance: w.agentGov,
            servicingWallet: w.servicing,
            calculationAgent: vm.addr(vm.envUint("CALCULATION_AGENT_PK")),
            funder: vm.addr(vm.envUint("AGENT_PK")),
            minInstitutions: 2,
            minSignatures: 4,
            tier2Delay: LOCAL_TIER2_DELAY,
            recoveryDelay: LOCAL_RECOVERY_DELAY,
            executionWindow: LOCAL_EXECUTION_WINDOW,
            venue: _venue(j)
        });
    }

    function _venue(string memory j) private view returns (Programme.Venue memory) {
        if (!vm.keyExistsJson(j, ".venue.allowlistChecker")) return Programme.Venue(address(0), address(0), address(0));
        return Programme.Venue({
            checker: vm.parseJsonAddress(j, ".venue.allowlistChecker"),
            adapter: vm.parseJsonAddress(j, ".venue.permissionsAdapter"),
            credentialGate: vm.parseJsonAddress(j, ".venue.credentialGate")
        });
    }

    function _record(Programme.Deployed memory p, Wallets memory w) private {
        string memory o = "governance";
        vm.serializeAddress(o, "controller", address(p.controller));
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
        vm.writeJson(vm.toString(address(p.factory)), _manifest(), ".identity.noteFactory");
        vm.writeJson(vm.toString(address(p.sanctions)), _manifest(), ".programme.sanctions");
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

    function _mnemonic() private view returns (string memory) {
        return block.chainid == 31337 ? MNEMONIC : vm.envString("WALLET_MNEMONIC");
    }

    function _manifest() private view returns (string memory) {
        return string.concat("../", vm.envOr("MANIFEST", string("ops/addresses.json")));
    }
}
