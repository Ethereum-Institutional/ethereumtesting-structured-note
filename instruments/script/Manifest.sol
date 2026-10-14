// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IdFactory} from "@onchain-id/solidity/contracts/factory/IdFactory.sol";
import {TREXFactory} from "t-rex/factory/TREXFactory.sol";
import {IdentityRegistry} from "t-rex/registry/implementation/IdentityRegistry.sol";
import {IdentityRegistryStorage} from "t-rex/registry/implementation/IdentityRegistryStorage.sol";
import {ClaimTopicsRegistry} from "t-rex/registry/implementation/ClaimTopicsRegistry.sol";
import {TrustedIssuersRegistry} from "t-rex/registry/implementation/TrustedIssuersRegistry.sol";
import {IERC3643IdentityRegistry} from "t-rex/ERC-3643/IERC3643IdentityRegistry.sol";
import {FixedImplementationAuthority} from "../src/FixedImplementationAuthority.sol";
import {ExpiringClaimIssuer} from "../src/claims/ExpiringClaimIssuer.sol";
import {DepositToken} from "../src/DepositToken.sol";
import {DepositGateway} from "../src/DepositGateway.sol";
import {INote} from "../src/interfaces/INote.sol";
import {DeterminationAgent} from "../src/DeterminationAgent.sol";
import {RecordDateModule} from "../src/compliance/RecordDateModule.sol";
import {PayingAgent} from "../src/PayingAgent.sol";
import {LockedSettlement} from "../src/LockedSettlement.sol";
import {Scaffolding} from "./Scaffolding.sol";
import {Issuance} from "./Issuance.sol";

/// The deployment as the manifest records it, for the scripts that run after it.
library Manifest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function scaffolding(string memory j) internal pure returns (Scaffolding.Deployed memory d) {
        d.idFactory = IdFactory(vm.parseJsonAddress(j, ".identity.idFactory"));
        d.trexFactory = TREXFactory(vm.parseJsonAddress(j, ".identity.trexFactory"));
        d.trexAuthority = FixedImplementationAuthority(vm.parseJsonAddress(j, ".identity.trexAuthority"));
        d.bankIssuer = ExpiringClaimIssuer(vm.parseJsonAddress(j, ".identity.bankIssuer"));
        d.onboardingIssuer = ExpiringClaimIssuer(vm.parseJsonAddress(j, ".identity.onboardingIssuer"));
        d.identities = IdentityRegistryStorage(vm.parseJsonAddress(j, ".identity.identityStorage"));
        d.depositRegistry = IdentityRegistry(vm.parseJsonAddress(j, ".identity.depositRegistry"));
        d.depositTopics = ClaimTopicsRegistry(vm.parseJsonAddress(j, ".identity.depositTopics"));
        d.depositIssuers = TrustedIssuersRegistry(vm.parseJsonAddress(j, ".identity.depositIssuers"));
        d.deposit = DepositToken(vm.parseJsonAddress(j, ".instruments.deposit"));
        d.gateway = DepositGateway(vm.parseJsonAddress(j, ".instruments.gateway"));
    }

    function issued(string memory j) internal pure returns (Issuance.Issued memory l) {
        l.note = INote(vm.parseJsonAddress(j, ".instruments.note"));
        l.identityRegistry = IERC3643IdentityRegistry(vm.parseJsonAddress(j, ".noteSuite.identityRegistry"));
        l.compliance = vm.parseJsonAddress(j, ".noteSuite.compliance");
        l.trustedIssuers = vm.parseJsonAddress(j, ".noteSuite.trustedIssuers");
        l.claimTopics = vm.parseJsonAddress(j, ".noteSuite.claimTopics");
        l.determinations = DeterminationAgent(vm.parseJsonAddress(j, ".lifecycle.determinations"));
        l.recordDates = RecordDateModule(vm.parseJsonAddress(j, ".lifecycle.recordDates"));
        l.payingAgent = PayingAgent(vm.parseJsonAddress(j, ".lifecycle.payingAgent"));
        l.settlement = LockedSettlement(vm.parseJsonAddress(j, ".lifecycle.settlement"));
    }
}
