// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {Identity} from "@onchain-id/solidity/contracts/Identity.sol";
import {IdFactory} from "@onchain-id/solidity/contracts/factory/IdFactory.sol";
import {ImplementationAuthority} from "@onchain-id/solidity/contracts/proxy/ImplementationAuthority.sol";
import {Token} from "t-rex/token/Token.sol";
import {IdentityRegistry} from "t-rex/registry/implementation/IdentityRegistry.sol";
import {IdentityRegistryStorage} from "t-rex/registry/implementation/IdentityRegistryStorage.sol";
import {ClaimTopicsRegistry} from "t-rex/registry/implementation/ClaimTopicsRegistry.sol";
import {TrustedIssuersRegistry} from "t-rex/registry/implementation/TrustedIssuersRegistry.sol";
import {ModularCompliance} from "t-rex/compliance/modular/ModularCompliance.sol";
import {TREXFactory} from "t-rex/factory/TREXFactory.sol";
import {ClaimTopicsRegistryProxy} from "t-rex/proxy/ClaimTopicsRegistryProxy.sol";
import {TrustedIssuersRegistryProxy} from "t-rex/proxy/TrustedIssuersRegistryProxy.sol";
import {IdentityRegistryProxy} from "t-rex/proxy/IdentityRegistryProxy.sol";
import {IdentityRegistryStorageProxy} from "t-rex/proxy/IdentityRegistryStorageProxy.sol";

import {FixedImplementationAuthority} from "../src/FixedImplementationAuthority.sol";
import {ExpiringClaimIssuer} from "../src/claims/ExpiringClaimIssuer.sol";
import {ClaimTopics} from "../src/claims/ClaimTopics.sol";
import {DepositToken} from "../src/DepositToken.sol";
import {DepositGateway, IMintBurn} from "../src/DepositGateway.sol";
import {IVerifies} from "../src/interfaces/INote.sol";

/**
 * The shared scaffolding of a deployment, built once: identities, T-REX, the institutions' claim
 * issuers, and the tokenized deposit with its eligibility (ADR 0088). Each note is then issued on
 * it (script/Issuance.sol). Used by the deploy script and the tests alike, so the tests exercise
 * exactly what is deployed.
 *
 * - **Identities.** ONCHAINID's identity factory, and the implementation behind every identity,
 *   fixed for good: its authority's owner renounces. The bank creates every identity, so the
 *   factory is handed to the bank.
 * - **T-REX.** One implementation of each contract, behind a fixed implementation authority, and
 *   T-REX's factory, which the Issuer owns to issue notes.
 * - **Claim issuers.** The bank's, which vouches that a client may hold its deposit, and the
 *   onboarding agent's, which vouches that a client may hold the note. Each is managed by its
 *   institution's key.
 * - **One identity storage** for the deployment, owned by T-REX's factory so that each note's
 *   registry binds to it, and the deposit's own identity registry on it, which trusts the bank
 *   alone. A client registered once is known to every registry.
 * - **The pool's identity registry** on the same storage, which trusts the bank alone for the
 *   pool-access claim (ADR 0090). It is never bound to the storage, so it only reads: a
 *   client registered once is known to the pool too. The conversion pool's gate asks it.
 * - **The deposit** and its gateway. The bank administers the deposit's eligibility and mints and
 *   burns through the gateway; the deployer administers both contracts until the ceremony.
 *
 * Must be called by `c.deployer`.
 */
library Scaffolding {
    struct Config {
        address deployer;
        /// @dev The bank: the Deposit Agent's key.
        address bank;
        /// @dev The onboarding agent's key, which vouches for clients for the note.
        address onboardingAgent;
        /// @dev The longest a claim may run, at either claim issuer.
        uint48 maxClaimValidity;
        string depositName;
        string depositSymbol;
    }

    struct Deployed {
        IdFactory idFactory;
        TREXFactory trexFactory;
        FixedImplementationAuthority trexAuthority;
        ExpiringClaimIssuer bankIssuer;
        ExpiringClaimIssuer onboardingIssuer;
        /// @dev The deployment's identity storage, shared by every registry.
        IdentityRegistryStorage identities;
        /// @dev The deposit's identity registry, and its topics and trusted issuers.
        IdentityRegistry depositRegistry;
        ClaimTopicsRegistry depositTopics;
        TrustedIssuersRegistry depositIssuers;
        /// @dev The pool's identity registry, read-only, and its topics and trusted issuers.
        IdentityRegistry poolRegistry;
        ClaimTopicsRegistry poolTopics;
        TrustedIssuersRegistry poolIssuers;
        DepositToken deposit;
        DepositGateway gateway;
    }

    /// @dev Investors' and the institutions' country in the identity storage (ISO 3166 numeric).
    uint16 internal constant COUNTRY = 276;

    function deploy(Config memory c) internal returns (Deployed memory d) {
        // Identities: their logic fixed for good once the authority's owner renounces.
        ImplementationAuthority identityAuthority =
            new ImplementationAuthority(address(new Identity(c.deployer, true)));
        d.idFactory = new IdFactory(address(identityAuthority));
        identityAuthority.renounceOwnership();

        // T-REX: one implementation of each contract, fixed.
        d.trexAuthority = new FixedImplementationAuthority(
            address(new Token()),
            address(new ClaimTopicsRegistry()),
            address(new IdentityRegistry()),
            address(new IdentityRegistryStorage()),
            address(new TrustedIssuersRegistry()),
            address(new ModularCompliance())
        );
        d.trexFactory = new TREXFactory(address(d.trexAuthority), address(d.idFactory));
        d.idFactory.addTokenFactory(address(d.trexFactory));

        // The institutions' claim issuers.
        d.bankIssuer = new ExpiringClaimIssuer(c.bank, c.maxClaimValidity);
        d.onboardingIssuer = new ExpiringClaimIssuer(c.onboardingAgent, c.maxClaimValidity);

        // The deposit's eligibility: the bank's claim, from the bank's issuer.
        (d.depositTopics, d.depositIssuers) =
            _topicsAndIssuers(d, c.deployer, ClaimTopics.DEPOSIT_ELIGIBLE, address(d.bankIssuer));

        // The deposit's registry is built first, against a placeholder, so that the storage can bind
        // it as it is built: the storage is owned by T-REX's factory, which cannot bind anything
        // after. The bank is the registry's agent: it registers its clients' identities.
        d.depositRegistry = IdentityRegistry(
            address(
                new IdentityRegistryProxy(
                    address(d.trexAuthority),
                    address(d.depositIssuers),
                    address(d.depositTopics),
                    address(1),
                    c.deployer,
                    new address[](0),
                    c.bank
                )
            )
        );
        d.identities = IdentityRegistryStorage(
            address(
                new IdentityRegistryStorageProxy(address(d.trexAuthority), address(d.trexFactory), address(d.depositRegistry))
            )
        );
        d.depositRegistry.setIdentityRegistryStorage(address(d.identities));

        // The pool's access: the bank's claim, from the bank's issuer (ADR 0090).
        (d.poolTopics, d.poolIssuers) = _topicsAndIssuers(d, c.deployer, ClaimTopics.POOL_ACCESS, address(d.bankIssuer));
        d.poolRegistry = IdentityRegistry(
            address(
                new IdentityRegistryProxy(
                    address(d.trexAuthority),
                    address(d.poolIssuers),
                    address(d.poolTopics),
                    address(d.identities),
                    c.deployer,
                    new address[](0),
                    c.bank
                )
            )
        );

        // The deposit and its gateway.
        d.deposit = new DepositToken(c.depositName, c.depositSymbol, c.deployer, IVerifies(address(d.depositRegistry)));
        d.gateway = new DepositGateway(IMintBurn(address(d.deposit)), c.deployer, c.bank);
        d.deposit.grantRole(d.deposit.MINTER_ROLE(), address(d.gateway));
        d.deposit.grantRole(d.deposit.BURNER_ROLE(), address(d.gateway));
        d.deposit.grantRole(d.deposit.PAUSER_ROLE(), c.bank);
        d.deposit.grantRole(d.deposit.ALLOWLIST_ROLE(), c.bank);
        d.deposit.grantRole(d.deposit.FREEZER_ROLE(), c.bank);

        // The deposit's eligibility is the bank's to keep: it accepts each registry once offered.
        d.depositTopics.transferOwnership(c.bank);
        d.depositIssuers.transferOwnership(c.bank);
        d.depositRegistry.transferOwnership(c.bank);
        d.idFactory.transferOwnership(c.bank);
    }

    /// One required topic, and one issuer trusted for it.
    function _topicsAndIssuers(Deployed memory d, address owner, uint256 topic, address issuer)
        private
        returns (ClaimTopicsRegistry topics, TrustedIssuersRegistry issuers)
    {
        uint256[] memory required = new uint256[](1);
        required[0] = topic;
        address[] memory trusted = new address[](1);
        trusted[0] = issuer;
        uint256[][] memory trustedFor = new uint256[][](1);
        trustedFor[0] = required;
        topics = ClaimTopicsRegistry(address(new ClaimTopicsRegistryProxy(address(d.trexAuthority), owner, required)));
        issuers = TrustedIssuersRegistry(
            address(new TrustedIssuersRegistryProxy(address(d.trexAuthority), owner, trusted, trustedFor))
        );
    }

    /// The bank accepts the deposit's registries. Must be called by the bank.
    function acceptByBank(Deployed memory d) internal {
        d.depositTopics.acceptOwnership();
        d.depositIssuers.acceptOwnership();
        d.depositRegistry.acceptOwnership();
    }
}
