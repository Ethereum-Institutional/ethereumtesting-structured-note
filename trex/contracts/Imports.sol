// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/**
 * @title Imports
 * @notice Pulls the ERC-3643 (T-REX) and ONCHAINID contracts we deploy into the
 *         Hardhat compilation unit so their artifacts are generated.
 *         Nothing here is deployed directly -- see scripts/deploy.ts.
 *
 *         This build is pinned to solc 0.8.17 + OpenZeppelin v4, matching T-REX.
 *         The Uniswap venue contracts live in a separate Foundry build
 *         (solc 0.8.26 + OpenZeppelin v5) and interact with these only by ABI.
 */

// --- ONCHAINID (identity layer) ---
import "@onchain-id/solidity/contracts/Identity.sol";
import "@onchain-id/solidity/contracts/ClaimIssuer.sol";
import "@onchain-id/solidity/contracts/proxy/ImplementationAuthority.sol";
import "@onchain-id/solidity/contracts/proxy/IdentityProxy.sol";
import "@onchain-id/solidity/contracts/factory/IdFactory.sol";

// --- T-REX registries ---
import "@tokenysolutions/t-rex/contracts/registry/implementation/ClaimTopicsRegistry.sol";
import "@tokenysolutions/t-rex/contracts/registry/implementation/TrustedIssuersRegistry.sol";
import "@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistryStorage.sol";
import "@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol";

// --- T-REX compliance ---
import "@tokenysolutions/t-rex/contracts/compliance/modular/ModularCompliance.sol";
import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/ModuleProxy.sol";
import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/CountryAllowModule.sol";
import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/MaxBalanceModule.sol";
import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/SupplyLimitModule.sol";
import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/TimeTransfersLimitsModule.sol";

// --- T-REX token + proxy/authority infrastructure ---
import "@tokenysolutions/t-rex/contracts/token/Token.sol";
import "@tokenysolutions/t-rex/contracts/proxy/authority/TREXImplementationAuthority.sol";
import "@tokenysolutions/t-rex/contracts/proxy/authority/IAFactory.sol";
import "@tokenysolutions/t-rex/contracts/proxy/TokenProxy.sol";
import "@tokenysolutions/t-rex/contracts/proxy/ClaimTopicsRegistryProxy.sol";
import "@tokenysolutions/t-rex/contracts/proxy/TrustedIssuersRegistryProxy.sol";
import "@tokenysolutions/t-rex/contracts/proxy/IdentityRegistryStorageProxy.sol";
import "@tokenysolutions/t-rex/contracts/proxy/IdentityRegistryProxy.sol";
import "@tokenysolutions/t-rex/contracts/proxy/ModularComplianceProxy.sol";
import "@tokenysolutions/t-rex/contracts/factory/TREXFactory.sol";
