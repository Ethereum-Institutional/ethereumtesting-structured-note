/**
 * The cross-boundary handshake.
 *
 * Uniswap's PermissionsAdapter physically custodies the ERC-3643 token, so under the
 * token's own transfer rules it must be a verified holder like any other. This script has
 * the issuer:
 *
 *   1. mint the adapter an ONCHAINID (with the issuer as management key, since a contract
 *      cannot sign for itself),
 *   2. attest KYC on it through the same trusted claim issuer used for investors,
 *   3. register it in the identity registry under an allowed jurisdiction,
 *   4. seed it with 1 wei of the asset -- the on-chain proof of allow-listing that
 *      PermissionsAdapterFactory.verifyPermissionsAdapter checks for.
 *
 * Nothing here is Uniswap-specific from the issuer's side: the venue is onboarded exactly
 * like an investor, which is what makes the model auditable.
 */
import { ethers } from "hardhat";
import { COUNTRY, TOPIC, loadAddresses, saveAddresses, signClaim, keyOf, utf8 } from "./lib";

const ADAPTER_ABI = [
  "function depositForVerification(uint256 amount) external",
  "function PERMISSIONED_TOKEN() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const [issuer, agent, claimSigner, alice] = await ethers.getSigners();
  const a = loadAddresses();
  const adapter: string = a?.venue?.permissionsAdapter;
  if (!adapter) throw new Error("venue.permissionsAdapter missing -- run 01_DeployVenue first");

  const idFactory = await ethers.getContractAt("IdFactory", a.trex.idFactory);
  const ir = await ethers.getContractAt("IdentityRegistry", a.trex.identityRegistry);
  const token = await ethers.getContractAt("Token", a.trex.token);

  console.log("\n=== onboarding the pool adapter as a verified holder ===");
  console.log("adapter:", adapter);

  // 1. Identity, with the issuer as management key so claims can be added for it.
  let adapterIdentity: string = await idFactory.getIdentity(adapter);
  if (adapterIdentity === ethers.ZeroAddress) {
    await (
      await idFactory.createIdentityWithManagementKeys(adapter, "uniswap-permissions-adapter", [
        keyOf(issuer.address),
      ])
    ).wait();
    adapterIdentity = await idFactory.getIdentity(adapter);
  }
  console.log("identity:", adapterIdentity);

  // 2. KYC claim from the same trusted issuer that verified the investors.
  const identity = await ethers.getContractAt("Identity", adapterIdentity);
  const existing = await identity.getClaimIdsByTopic(TOPIC.KYC);
  if (existing.length === 0) {
    const data = utf8("KYC verified: Uniswap v4 permissions adapter (venue custody)");
    const sig = await signClaim(claimSigner, adapterIdentity, TOPIC.KYC, data);
    await (
      await (identity.connect(issuer) as any).addClaim(
        TOPIC.KYC, 1, a.trex.claimIssuer, sig, data, "",
      )
    ).wait();
  }
  console.log("KYC claim added");

  // 3. Register in the identity registry under Singapore (an allowed jurisdiction).
  if (!(await ir.contains(adapter))) {
    await (await (ir.connect(agent) as any).registerIdentity(adapter, adapterIdentity, COUNTRY.SG)).wait();
  }
  const verified = await ir.isVerified(adapter);
  console.log("isVerified(adapter):", verified);
  if (!verified) throw new Error("adapter failed isVerified -- cannot hold the asset");

  // 4. Seed 1 wei from a verified holder so the factory can prove the allow-listing.
  const adapterContract = new ethers.Contract(adapter, ADAPTER_ABI, alice);
  if ((await token.balanceOf(adapter)) === 0n) {
    await (await (token.connect(alice) as any).approve(adapter, 1n)).wait();
    await (await adapterContract.depositForVerification(1n)).wait();
  }
  console.log("adapter asset balance:", (await token.balanceOf(adapter)).toString(), "wei");

  saveAddresses({ adapterIdentity });
  console.log("adapter is now a verified holder; venue can be activated");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
