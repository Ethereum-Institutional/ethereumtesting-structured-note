import "server-only";
import { defineChain, parseAbi, type Hex } from "viem";
import { loadManifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";
import type { Attestation, RegistryGrant } from "./assess.ts";

/**
 * Writes an approved admission's two grants as the Access Issuer (ADRs 0044, 0048): the pool
 * grant, then the Identity Registry grant. The deployment is the one MANIFEST_JSON (or
 * MANIFEST_PATH) describes, reached at RPC_URL; the Access Issuer's key is `accessIssuer` in
 * SIGNER_KEYS. Each call is simulated first, so a refusal is reported with the gate's own reason
 * and nothing is sent.
 */

const GATE = parseAbi([
  "function issuerDid() view returns (string)",
  "function grant((address account, uint8 path, bytes32 primaryCredential, bytes32 screeningCredential, bytes32 walletCredential, bytes32 authorityCredential, bytes32 primarySchema, bytes32 screeningSchema, uint32 checks, bytes2 jurisdiction, uint8 investorClass, uint40 screenedAt, uint40 credentialExpiry, bytes32 evidence) a) returns (uint40)",
]);
const REGISTRY = parseAbi([
  "function grant(address account, uint32 flags, uint16 jurisdiction, uint40 expiresAt, bytes32 credentialRef, bytes32 commitment)",
]);

// The Identity Registry's flags (instruments/src/IdentityRegistry.sol).
const HOLD = 1 << 0;
const RECEIVE = 1 << 1;
const TRANSFER = 1 << 2;
const PROFESSIONAL = 1 << 10;
const SANCTIONS_CLEAR = 1 << 13;
const CONTRACT_ACCOUNT = 1 << 14;

export function registryFlags(g: RegistryGrant): number {
  let f = HOLD | RECEIVE | TRANSFER | SANCTIONS_CLEAR;
  if (g.flags.professional) f |= PROFESSIONAL;
  if (g.flags.contractAccount) f |= CONTRACT_ACCOUNT;
  return f;
}

function deployment() {
  const m = loadManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({
    id: m.chainId,
    name: `chain ${m.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const gate = m.venue.credentialGate;
  const registry = m.instruments?.registry;
  if (!registry) throw new Error("the manifest has no Identity Registry");
  return { chain, rpc, gate, registry };
}

export type Written = { chainId: number; poolGrantTx: Hex; registryGrantTx: Hex };

export async function writeGrants(issuerDid: string, a: Attestation, r: RegistryGrant): Promise<Written> {
  const d = deployment();
  const s = signers(d.chain, d.rpc);
  const from = s.address("accessIssuer");

  const configured = await s.publicClient.readContract({ address: d.gate, abi: GATE, functionName: "issuerDid" });
  if (configured !== issuerDid) throw new Error(`the pool gate is configured for ${configured}, not ${issuerDid}`);

  const tuple = { ...a, path: a.path, jurisdiction: a.jurisdiction };
  const registryArgs = [r.account, registryFlags(r), r.jurisdiction, r.expiresAt, r.credentialRef, r.commitment] as const;

  // Simulated first: a refusal names its reason and sends nothing.
  await s.publicClient.simulateContract({ address: d.gate, abi: GATE, functionName: "grant", args: [tuple], account: from });
  const poolGrantTx = await s.send("accessIssuer", { address: d.gate, abi: GATE, functionName: "grant", args: [tuple] });
  await succeeded(s.publicClient, poolGrantTx, "pool grant");

  await s.publicClient.simulateContract({ address: d.registry, abi: REGISTRY, functionName: "grant", args: registryArgs, account: from });
  const registryGrantTx = await s.send("accessIssuer", { address: d.registry, abi: REGISTRY, functionName: "grant", args: registryArgs });
  await succeeded(s.publicClient, registryGrantTx, "registry grant");

  return { chainId: d.chain.id, poolGrantTx, registryGrantTx };
}

async function succeeded(client: ReturnType<typeof signers>["publicClient"], hash: Hex, what: string) {
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`the ${what} reverted (${hash})`);
}
