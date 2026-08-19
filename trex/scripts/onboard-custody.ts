/**
 * The issuer onboards the custodian's segregated client accounts.
 *
 * Each account is a contract, so it cannot sign for itself -- the identity is created with
 * the issuer as management key, exactly as the pool adapter was. From the issuer's books
 * every client is an independent verified holder: freeze one, report on one, force-transfer
 * from one, and no other client is affected. That is what segregation buys you over an
 * omnibus wallet.
 *
 * CLIENT-D is skipped on purpose: it holds cash and has working approvals, so when its trade
 * fails the only possible cause is the compliance gate.
 */
import { ethers } from "hardhat";
import { COUNTRY, TOPIC, loadAddresses, saveAddresses, signClaim, keyOf, utf8 } from "./lib";

type ClientSpec = {
  ref: string;
  name: string;
  country: number;
  professional: boolean;
  allocation: string; // APACDC units minted by the agent
};

const CLIENTS: ClientSpec[] = [
  { ref: "CLIENT-A", name: "Sakura Asset Management", country: COUNTRY.JP, professional: true, allocation: "120000" },
  { ref: "CLIENT-B", name: "Lion City Family Office", country: COUNTRY.SG, professional: true, allocation: "80000" },
  { ref: "CLIENT-C", name: "Harbour Retail Nominee", country: COUNTRY.HK, professional: false, allocation: "45000" },
];

const SKIPPED = { ref: "CLIENT-D", name: "Prospect Capital (KYC pending)" };

async function main() {
  const [issuer, agent, claimSigner] = await ethers.getSigners();
  const a = loadAddresses();
  if (!a?.custody?.factory) throw new Error("custody.factory missing -- run 04_DeployCustody first");

  const idFactory = await ethers.getContractAt("IdFactory", a.trex.idFactory);
  const ir = await ethers.getContractAt("IdentityRegistry", a.trex.identityRegistry);
  const token = await ethers.getContractAt("Token", a.trex.token);
  const decimals: number = a.trex.decimals;

  console.log(`\n=== ${a.custody.custodianName}: onboarding segregated client accounts ===`);

  const onboarded: any[] = [];

  for (const c of CLIENTS) {
    const account: string = a.custody[c.ref];
    if (!account) throw new Error(`missing address for ${c.ref}`);

    // 1. Identity, issuer holds the management key (the account is a contract).
    let identity: string = await idFactory.getIdentity(account);
    if (identity === ethers.ZeroAddress) {
      await (
        await idFactory.createIdentityWithManagementKeys(account, `custody-${c.ref.toLowerCase()}`, [
          keyOf(issuer.address),
        ])
      ).wait();
      identity = await idFactory.getIdentity(account);
    }

    // 2. Claims from the trusted KYC provider.
    const idContract = await ethers.getContractAt("Identity", identity);
    const topics = c.professional ? [TOPIC.KYC, TOPIC.PROFESSIONAL] : [TOPIC.KYC];
    for (const topic of topics) {
      if ((await idContract.getClaimIdsByTopic(topic)).length > 0) continue;
      const data = utf8(
        topic === TOPIC.KYC
          ? `KYC verified: ${c.name} (via ${a.custody.custodianName})`
          : `Professional investor: ${c.name}`,
      );
      const sig = await signClaim(claimSigner, identity, topic, data);
      await (
        await (idContract.connect(issuer) as any).addClaim(topic, 1, a.trex.claimIssuer, sig, data, "")
      ).wait();
    }

    // 3. Register as an independent holder of record.
    if (!(await ir.contains(account))) {
      await (await (ir.connect(agent) as any).registerIdentity(account, identity, c.country)).wait();
    }
    const verified = await ir.isVerified(account);
    if (!verified) throw new Error(`${c.ref} failed isVerified`);

    // 4. Allocate the client's holding.
    const target = ethers.parseUnits(c.allocation, decimals);
    const held = await token.balanceOf(account);
    if (held < target) {
      await (await (token.connect(agent) as any).mint(account, target - held)).wait();
    }

    onboarded.push({
      ref: c.ref,
      name: c.name,
      account,
      identity,
      country: c.country,
      professional: c.professional,
      claims: topics,
      custodian: a.custody.custodianName,
    });
    console.log(
      `  ${c.ref}  ${c.name.padEnd(26)} ${account}  ${c.country}  claims=[${topics}]  ${c.allocation} units`,
    );
  }

  console.log(`  ${SKIPPED.ref}  ${SKIPPED.name.padEnd(26)} ${a.custody["CLIENT-D"]}  — not onboarded (control)`);

  saveAddresses({
    custodyClients: onboarded,
    custodyPending: [{ ref: SKIPPED.ref, name: SKIPPED.name, account: a.custody["CLIENT-D"] }],
  });
  console.log("\ncustody clients onboarded; each is an independent verified holder");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
