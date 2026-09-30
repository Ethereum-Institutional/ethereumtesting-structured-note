import "server-only";
import { decodeFunctionData, defineChain, parseAbi, type Hex } from "viem";
import { loadManifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";
import { issuedCredentials, type BankConfig, type IssuedCredential } from "./bank.ts";

/**
 * Whether the credentials a grant rests on are anchored in the bank's registry (ADR 0060). The
 * bank issues a credential at once and anchors it in its next batch, about a minute later, by
 * calling updateRoot(issuerDid, batchRoot) on the protocol's root registry.
 *
 * A credential counts as anchored when the bank reports it anchored and, on the pool's own chain,
 * its anchoring transaction succeeded as an updateRoot call for the configured issuer on the
 * registry the pool gate reads. What cannot be checked yet: that the credential is inside that
 * batch, which needs an inclusion proof the bank does not publish.
 */

export type Anchor = {
  credentialId: Hex;
  /** The credential's own root, as the bank reports it. */
  credentialRoot: Hex | null;
  anchorTx: Hex;
  anchorChain: string;
  /** The batch root the transaction anchored; null where the anchor is on another chain. */
  anchoredRoot: Hex | null;
  /** Whether the transaction itself was read and checked on the pool's chain. */
  verifiedOnChain: boolean;
};

export type Anchoring = { anchored: Anchor[]; pending: Hex[] };

const GATE = parseAbi(["function REVOCATIONS() view returns (address)"]);
const ROOTS = parseAbi(["function updateRoot(string did, bytes32 root)"]);

function chainContext() {
  const m = loadManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, s: signers(chain, rpc) };
}

const anchoredState = (c: IssuedCredential) => Boolean(c.rootAnchorTxHash) && /anchored|picked_up/i.test(c.state) && !/pending/i.test(c.state);

export async function anchoringOf(bank: BankConfig, issuerDid: string, credentialIds: Hex[]): Promise<Anchoring> {
  const { m, s } = chainContext();
  const issued = new Map((await issuedCredentials(bank)).map((c) => [c.credentialId.toLowerCase(), c]));
  const registry = (await s.publicClient.readContract({ address: m.venue.credentialGate, abi: GATE, functionName: "REVOCATIONS" })).toLowerCase();
  const out: Anchoring = { anchored: [], pending: [] };

  for (const id of credentialIds) {
    const c = issued.get(id.toLowerCase());
    if (!c) throw new Error(`the bank has no record of credential ${id}, so it cannot be anchored in its registry`);
    if (c.revokedAt) throw new Error(`credential ${id} was revoked by the bank`);
    if (!anchoredState(c)) {
      out.pending.push(id);
      continue;
    }
    const anchorTx = c.rootAnchorTxHash as Hex;
    const anchorChain = c.rootAnchorChain ?? "";
    if (anchorChain !== `eip155:${m.chainId}`) {
      // An ordinary wallet may be attested on another EVM chain (ADR 0042); its anchor is there too.
      out.anchored.push({ credentialId: id, credentialRoot: (c.rootHex as Hex) ?? null, anchorTx, anchorChain, anchoredRoot: null, verifiedOnChain: false });
      continue;
    }
    const [tx, receipt] = await Promise.all([
      s.publicClient.getTransaction({ hash: anchorTx }),
      s.publicClient.getTransactionReceipt({ hash: anchorTx }),
    ]);
    if (receipt.status !== "success") throw new Error(`the bank's anchoring transaction for ${id} failed on-chain (${anchorTx})`);
    if (tx.to?.toLowerCase() !== registry) throw new Error(`the bank anchored ${id} on ${tx.to}, not the registry the pool reads (${registry})`);
    const call = decodeFunctionData({ abi: ROOTS, data: tx.input });
    if (call.functionName !== "updateRoot" || call.args[0] !== issuerDid) {
      throw new Error(`the anchoring transaction for ${id} is not a root update for ${issuerDid}`);
    }
    out.anchored.push({ credentialId: id, credentialRoot: (c.rootHex as Hex) ?? null, anchorTx, anchorChain, anchoredRoot: call.args[1], verifiedOnChain: true });
  }
  return out;
}
