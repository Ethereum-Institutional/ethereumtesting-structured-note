import "server-only";
import { decodeAbiParameters, encodeAbiParameters, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { loadManifest } from "../chain/manifest.ts";
import { getStore } from "../store.ts";
import { chainClient } from "./registry.ts";
import { differences, hashOf, validate, type ChainTerms, type TermSheet } from "./termsheet.ts";

/**
 * Where term sheets are kept and published (ADR 0095): each record by the hash its note carries,
 * the deployment's own in its manifest and the site's in its store, and the claim on a note's
 * identity that names it.
 */

const TERM_SHEET = BigInt(keccak256(toBytes("claim.term-sheet")));
const NOTE = parseAbi(["function onchainID() view returns (address)"]);
const IDENTITY = parseAbi(["function getClaim(bytes32 claimId) view returns (uint256 topic, uint256 scheme, address issuer, bytes signature, bytes data, string uri)"]);
const DETERMINATIONS = parseAbi([
  "function terms() view returns ((uint256[] initialLevels, uint64 calculationAmountCents, uint32 couponBarrierBps, uint32 couponRateBps, bool memory_, uint32 barrierBps, (bool applies, uint32 upBps, uint32 downBps, uint32 capBps) twinWin, (uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps)[] schedule))",
]);

/** The address a record is published at: the site's own, by its hash. */
export function termSheetUri(hash: Hex): string {
  const base = (process.env.SITE_URL ?? "http://localhost:3020").replace(/\/+$/, "");
  return `${base}/term-sheets/${hash}`;
}

/** Keeps a record the site issues a note from. Refuses one that is not valid. */
export async function keepTermSheet(t: TermSheet): Promise<Hex> {
  const problems = validate(t);
  if (problems.length) throw new Error(`The term sheet is not valid: ${problems.join("; ")}`);
  const hash = hashOf(t);
  await getStore().putTermSheet(hash, t);
  return hash;
}

/** The record with this hash, the deployment's or the site's; null if neither holds it. */
export async function termSheetByHash(hash: string): Promise<TermSheet | null> {
  const own = loadManifest().termSheet as TermSheet | undefined;
  if (own && hashOf(own).toLowerCase() === hash.toLowerCase()) return own;
  const kept = (await getStore().termSheet(hash)) as TermSheet | null;
  // Content-addressed: a record is returned only if it still hashes to its address.
  return kept && hashOf(kept).toLowerCase() === hash.toLowerCase() ? kept : null;
}

export type NoteTermSheet = { hash: Hex; uri: string; record: TermSheet | null; differences: string[] };

/** The term sheet a note's identity names, the record if it is held, and how the chain's terms differ from it. */
export async function termSheetOfNote(token: Address, determinations: Address, atBlock?: bigint): Promise<NoteTermSheet | null> {
  const { c } = chainClient();
  const pin = atBlock === undefined ? {} : { blockNumber: atBlock };
  const identity = await c.readContract({ address: token, abi: NOTE, functionName: "onchainID", ...pin });
  const claimId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [identity, TERM_SHEET]));
  const [topic, , , , data, uri] = await c.readContract({ address: identity, abi: IDENTITY, functionName: "getClaim", args: [claimId], ...pin });
  if (topic === 0n) return null;
  const [hash] = decodeAbiParameters([{ type: "bytes32" }, { type: "string" }], data);
  const record = await termSheetByHash(hash);
  if (!record) return { hash, uri, record: null, differences: [] };
  const onChain = (await c.readContract({ address: determinations, abi: DETERMINATIONS, functionName: "terms", ...pin })) as unknown as ChainTerms;
  return { hash, uri, record, differences: differences(record, onChain) };
}
