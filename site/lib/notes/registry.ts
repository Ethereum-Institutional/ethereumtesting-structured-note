import "server-only";
import { createPublicClient, defineChain, http, parseAbi, type Address, type Hex } from "viem";
import { loadManifest } from "../chain/manifest.ts";
import { indexed } from "../chain/events.ts";
import { getStore, type DemoNote } from "../store.ts";

/**
 * Every note on record: the notes the note factory issued, read from its own record on the chain,
 * the deployment's own note and each note issued from the site alike. Each is given in the shape
 * the lifecycle readers take, with the site's own record of it where there is one.
 */

const RECORD = "(uint256 series, address token, address identity, address identityRegistry, address compliance, address trustedIssuers, address claimTopics, address determinations, address recordDates, address payingAgent, address settlement, address inventory)";
const FACTORY = parseAbi([
  "function notes() view returns (address[])",
  `function noteOf(address token) view returns (${RECORD})`,
]);
const TOKEN = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)"]);

export type NoteOnRecord = {
  token: Address;
  name: string;
  symbol: string;
  /** The deployment's own note, issued with it. */
  underReview: boolean;
  series: number;
  isin: string;
  issuedBlock: bigint;
  issuedAt: number;
  issuedTx: Hex;
  /** The note as the lifecycle readers take it: the site's record, or one built from the chain. */
  note: DemoNote;
};

export function chainClient() {
  const m = loadManifest();
  const rpc = (process.env.LEDGER_RPC_URL ?? process.env.RPC_URL ?? "").trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, c: createPublicClient({ chain, transport: http(rpc) }) };
}

export async function notesOnRecord(): Promise<NoteOnRecord[]> {
  const { m, c } = chainClient();
  const factory = m.identity?.noteFactory as Address | undefined;
  if (!factory) throw new Error("The deployment has no note factory.");
  const [tokens, issued, stored] = await Promise.all([
    c.readContract({ address: factory, abi: FACTORY, functionName: "notes" }),
    indexed({ addresses: [factory], names: ["NoteIssued"], fresh: true }),
    getStore().listNotes(),
  ]);
  const underReview = (m.assets.note?.address ?? "").toLowerCase();
  return Promise.all(
    tokens.map(async (token): Promise<NoteOnRecord> => {
      const log = issued.find((l) => String(l.args.token).toLowerCase() === token.toLowerCase());
      if (!log) throw new Error(`the factory's record of ${token} has no issuance event`);
      const [record, name, symbol] = await Promise.all([
        c.readContract({ address: factory, abi: FACTORY, functionName: "noteOf", args: [token] }),
        c.readContract({ address: token, abi: TOKEN, functionName: "name" }),
        c.readContract({ address: token, abi: TOKEN, functionName: "symbol" }),
      ]);
      const isin = String(log.args.isin ?? "");
      const site = stored.find((n) => n.addresses.note?.toLowerCase() === token.toLowerCase());
      const note: DemoNote = site ?? {
        id: token,
        series: Number(record.series),
        ...(isin ? { isin } : {}),
        name,
        symbol,
        scenario: "",
        units: 0,
        status: "issued",
        step: 0,
        createdAt: new Date(log.at * 1000).toISOString(),
        by: "the deployment",
        addresses: {
          note: record.token,
          noteIdentity: record.identity,
          identityRegistry: record.identityRegistry,
          compliance: record.compliance,
          determinations: record.determinations,
          recordDates: record.recordDates,
          payingAgent: record.payingAgent,
          settlement: record.settlement,
        },
        txs: { note: log.tx, settlement: log.tx },
        data: { settlement: "locked" },
      };
      return { token, name, symbol, underReview: token.toLowerCase() === underReview, series: Number(record.series), isin, issuedBlock: BigInt(log.block), issuedAt: log.at, issuedTx: log.tx as Hex, note };
    }),
  );
}

export async function noteOnRecord(token: string): Promise<NoteOnRecord | null> {
  return (await notesOnRecord()).find((n) => n.token.toLowerCase() === token.toLowerCase()) ?? null;
}
