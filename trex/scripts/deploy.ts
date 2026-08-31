/**
 * Deploys the full ERC-3643 (T-REX) issuer stack to a local Anvil node.
 *
 * Roles (Anvil default accounts):
 *   0 issuer/deployer   -- owns the token, registries and compliance
 *   1 agent             -- day-to-day custody actions: freeze, force-transfer, mint
 *   2 claim issuer key  -- the KYC provider's signing key
 *   3 Alice   (SG)      -- verified, professional investor  -> may swap and provide liquidity
 *   4 Bob     (HK)      -- verified, retail                 -> may swap only
 *   5 Carol   (JP)      -- verified, professional
 *   6 Dave              -- no identity                      -> blocked everywhere
 */
import { ethers } from "hardhat";
import { COUNTRY, TOPIC, saveAddresses, signClaim, keyOf, utf8 } from "./lib";

const TOKEN_NAME = "APAC Money Market Fund";
const TOKEN_SYMBOL = "APMMF";
const DECIMALS = 18;

async function main() {
  const [issuer, agent, claimSigner, alice, bob, carol, dave] = await ethers.getSigners();
  const log = (...a: any[]) => console.log(...a);

  log("\n=== ERC-3643 issuer stack ===");
  log("issuer      ", issuer.address);
  log("agent       ", agent.address);
  log("claim signer", claimSigner.address);

  // ------------------------------------------------------------------ //
  // 1. ONCHAINID identity infrastructure
  // ------------------------------------------------------------------ //
  const identityImpl = await (await ethers.getContractFactory("Identity")).deploy(issuer.address, true);
  await identityImpl.waitForDeployment();

  const idImplAuthority = await (await ethers.getContractFactory("ImplementationAuthority")).deploy(
    await identityImpl.getAddress(),
  );
  await idImplAuthority.waitForDeployment();

  const idFactory = await (await ethers.getContractFactory("IdFactory")).deploy(
    await idImplAuthority.getAddress(),
  );
  await idFactory.waitForDeployment();
  log("ONCHAINID factory   ", await idFactory.getAddress());

  // ------------------------------------------------------------------ //
  // 2. T-REX logic implementations
  // ------------------------------------------------------------------ //
  const deployImpl = async (name: string) => {
    const c = await (await ethers.getContractFactory(name)).deploy();
    await c.waitForDeployment();
    return await c.getAddress();
  };

  const impls = {
    tokenImplementation: await deployImpl("Token"),
    ctrImplementation: await deployImpl("ClaimTopicsRegistry"),
    irImplementation: await deployImpl("IdentityRegistry"),
    irsImplementation: await deployImpl("IdentityRegistryStorage"),
    tirImplementation: await deployImpl("TrustedIssuersRegistry"),
    mcImplementation: await deployImpl("ModularCompliance"),
  };

  // The implementation authority lets the issuer upgrade every proxy in one move --
  // a governance property institutions ask about directly.
  const trexIA = await (await ethers.getContractFactory("TREXImplementationAuthority")).deploy(
    true,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
  );
  await trexIA.waitForDeployment();
  await (await trexIA.addAndUseTREXVersion({ major: 4, minor: 1, patch: 6 }, impls)).wait();
  log("T-REX impl authority", await trexIA.getAddress());

  // ------------------------------------------------------------------ //
  // 3. Proxies (the live contracts)
  // ------------------------------------------------------------------ //
  const iaAddr = await trexIA.getAddress();

  const ctrProxy = await (await ethers.getContractFactory("ClaimTopicsRegistryProxy")).deploy(iaAddr);
  await ctrProxy.waitForDeployment();
  const tirProxy = await (await ethers.getContractFactory("TrustedIssuersRegistryProxy")).deploy(iaAddr);
  await tirProxy.waitForDeployment();
  const irsProxy = await (await ethers.getContractFactory("IdentityRegistryStorageProxy")).deploy(iaAddr);
  await irsProxy.waitForDeployment();

  const irProxy = await (await ethers.getContractFactory("IdentityRegistryProxy")).deploy(
    iaAddr,
    await tirProxy.getAddress(),
    await ctrProxy.getAddress(),
    await irsProxy.getAddress(),
  );
  await irProxy.waitForDeployment();

  const mcProxy = await (await ethers.getContractFactory("ModularComplianceProxy")).deploy(iaAddr);
  await mcProxy.waitForDeployment();

  const tokenProxy = await (await ethers.getContractFactory("TokenProxy")).deploy(
    iaAddr,
    await irProxy.getAddress(),
    await mcProxy.getAddress(),
    TOKEN_NAME,
    TOKEN_SYMBOL,
    DECIMALS,
    ethers.ZeroAddress,
  );
  await tokenProxy.waitForDeployment();

  // Re-attach the logic ABIs onto the proxy addresses.
  const ctr = await ethers.getContractAt("ClaimTopicsRegistry", await ctrProxy.getAddress());
  const tir = await ethers.getContractAt("TrustedIssuersRegistry", await tirProxy.getAddress());
  const irs = await ethers.getContractAt("IdentityRegistryStorage", await irsProxy.getAddress());
  const ir = await ethers.getContractAt("IdentityRegistry", await irProxy.getAddress());
  const mc = await ethers.getContractAt("ModularCompliance", await mcProxy.getAddress());
  const token = await ethers.getContractAt("Token", await tokenProxy.getAddress());

  log("token               ", await token.getAddress());
  log("identity registry   ", await ir.getAddress());
  log("modular compliance  ", await mc.getAddress());

  // ------------------------------------------------------------------ //
  // 4. Wire the registries together
  // ------------------------------------------------------------------ //
  await (await irs.bindIdentityRegistry(await ir.getAddress())).wait();
  await (await ir.addAgent(agent.address)).wait();
  await (await ir.addAgent(await token.getAddress())).wait();
  await (await token.addAgent(agent.address)).wait();
  await (await mc.bindToken(await token.getAddress())).wait();

  // KYC is mandatory for every holder of this asset.
  await (await ctr.addClaimTopic(TOPIC.KYC)).wait();

  // ------------------------------------------------------------------ //
  // 5. The KYC provider: a ClaimIssuer trusted for KYC + professional-investor claims
  // ------------------------------------------------------------------ //
  const claimIssuer = await (await ethers.getContractFactory("ClaimIssuer")).deploy(issuer.address);
  await claimIssuer.waitForDeployment();
  // purpose 3 = CLAIM signer
  await (await claimIssuer.addKey(keyOf(claimSigner.address), 3, 1)).wait();
  await (
    await tir.addTrustedIssuer(await claimIssuer.getAddress(), [TOPIC.KYC, TOPIC.PROFESSIONAL])
  ).wait();
  log("claim issuer        ", await claimIssuer.getAddress());

  // ------------------------------------------------------------------ //
  // 6. Investor identities and claims
  // ------------------------------------------------------------------ //
  const investors = [
    { name: "Alice", signer: alice, country: COUNTRY.SG, professional: true },
    { name: "Bob", signer: bob, country: COUNTRY.HK, professional: false },
    { name: "Carol", signer: carol, country: COUNTRY.JP, professional: true },
  ];

  const claimIssuerAddr = await claimIssuer.getAddress();
  const registered: any[] = [];

  for (const inv of investors) {
    await (await idFactory.createIdentity(inv.signer.address, inv.name.toLowerCase())).wait();
    const idAddr = await idFactory.getIdentity(inv.signer.address);
    const identity = await ethers.getContractAt("Identity", idAddr);

    const topics = inv.professional ? [TOPIC.KYC, TOPIC.PROFESSIONAL] : [TOPIC.KYC];
    for (const topic of topics) {
      const data = utf8(
        topic === TOPIC.KYC
          ? `KYC verified: ${inv.name}`
          : `Professional investor: ${inv.name}`,
      );
      const sig = await signClaim(claimSigner, idAddr, topic, data);
      await (
        await (identity.connect(inv.signer) as any).addClaim(topic, 1, claimIssuerAddr, sig, data, "")
      ).wait();
    }

    registered.push({
      name: inv.name,
      wallet: inv.signer.address,
      identity: idAddr,
      country: inv.country,
      professional: inv.professional,
      claims: topics,
    });
    log(`  ${inv.name.padEnd(6)} ${inv.signer.address}  id=${idAddr}  claims=[${topics}]`);
  }

  await (
    await (ir.connect(agent) as any)
      .batchRegisterIdentity(
        registered.map((r) => r.wallet),
        registered.map((r) => r.identity),
        registered.map((r) => r.country),
      )
  ).wait();

  for (const r of registered) {
    const ok = await ir.isVerified(r.wallet);
    if (!ok) throw new Error(`${r.name} failed isVerified after registration`);
  }
  log("all investors isVerified() = true");

  // ------------------------------------------------------------------ //
  // 7. Compliance modules
  // ------------------------------------------------------------------ //
  const deployModule = async (name: string) => {
    const impl = await (await ethers.getContractFactory(name)).deploy();
    await impl.waitForDeployment();
    const proxy = await (await ethers.getContractFactory("ModuleProxy")).deploy(
      await impl.getAddress(),
      (await ethers.getContractFactory(name)).interface.encodeFunctionData("initialize"),
    );
    await proxy.waitForDeployment();
    return await proxy.getAddress();
  };

  const countryModule = await deployModule("CountryAllowModule");
  const supplyModule = await deployModule("SupplyLimitModule");
  const maxBalanceModule = await deployModule("MaxBalanceModule");

  await (await mc.addModule(countryModule)).wait();
  await (await mc.addModule(supplyModule)).wait();

  const countryIface = (await ethers.getContractFactory("CountryAllowModule")).interface;
  const supplyIface = (await ethers.getContractFactory("SupplyLimitModule")).interface;

  // Jurisdictions this fund may be distributed into.
  await (
    await mc.callModuleFunction(
      countryIface.encodeFunctionData("batchAllowCountries", [
        [COUNTRY.SG, COUNTRY.HK, COUNTRY.JP, COUNTRY.AU],
      ]),
      countryModule,
    )
  ).wait();

  const supplyLimit = ethers.parseUnits("10000000", DECIMALS);
  await (
    await mc.callModuleFunction(
      supplyIface.encodeFunctionData("setSupplyLimit", [supplyLimit]),
      supplyModule,
    )
  ).wait();
  log("compliance: CountryAllow[SG,HK,JP,AU] + SupplyLimit(10M) bound");
  log("            MaxBalance deployed but UNBOUND (bind live from the dashboard)");

  // ------------------------------------------------------------------ //
  // 8. Issue the asset
  // ------------------------------------------------------------------ //
  const mints: Record<string, string> = { Alice: "500000", Bob: "150000", Carol: "150000" };
  for (const r of registered) {
    await (await (token.connect(agent) as any).mint(r.wallet, ethers.parseUnits(mints[r.name], DECIMALS))).wait();
  }
  await (await (token.connect(agent) as any).unpause()).wait();
  log("minted and unpaused. total supply:", ethers.formatUnits(await token.totalSupply(), DECIMALS));

  // ------------------------------------------------------------------ //
  // 9. Persist
  // ------------------------------------------------------------------ //
  saveAddresses({
    chainId: 31337,
    trex: {
      token: await token.getAddress(),
      identityRegistry: await ir.getAddress(),
      identityRegistryStorage: await irs.getAddress(),
      claimTopicsRegistry: await ctr.getAddress(),
      trustedIssuersRegistry: await tir.getAddress(),
      modularCompliance: await mc.getAddress(),
      implementationAuthority: iaAddr,
      claimIssuer: claimIssuerAddr,
      idFactory: await idFactory.getAddress(),
      modules: {
        countryAllow: countryModule,
        supplyLimit: supplyModule,
        maxBalance: maxBalanceModule,
      },
      tokenName: TOKEN_NAME,
      tokenSymbol: TOKEN_SYMBOL,
      decimals: DECIMALS,
    },
    roles: {
      issuer: issuer.address,
      agent: agent.address,
      claimSigner: claimSigner.address,
      unverified: dave.address,
    },
    topics: TOPIC,
    investors: registered,
  });

  log("\naddresses written to ops/addresses.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
