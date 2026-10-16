import "server-only";
import { randomUUID } from "node:crypto";
import { parseAbi, type Address, type Log, type PublicClient } from "viem";
import { loadManifest } from "./manifest.ts";
import { client, deploymentBlock } from "../ledger.ts";
import { currentDeployment, getStore, type EventQuery, type IndexedEvent } from "../store.ts";

/**
 * The index of the programme's events (workstream 11): every event of the note factory, the
 * governance controller and each note's own contracts, decoded and held in the database, so pages
 * read the book from there rather than from the chain.
 *
 * - **Only new blocks are read.** The index records the last block it has read, under a lease, so
 *   one server reads at a time and none reads a block twice.
 * - **A note joins the index as it is issued:** the factory's events in a range are read first, and
 *   the notes they issued are read in the same range.
 * - **Not the newest blocks on a public network:** a few blocks are left for the chain to settle, so
 *   a reorganised block is not indexed.
 */

const EVENTS = parseAbi([
  // The note factory
  "event NoteIssued(address indexed token, uint256 indexed series, string isin, (uint256 series, address token, address identity, address identityRegistry, address compliance, address trustedIssuers, address claimTopics, address determinations, address recordDates, address payingAgent, address settlement, address inventory) note)",
  "event Retired(address indexed token)",
  // The governance controller
  "event Tier1(address indexed token, string action, string reason)",
  "event Proposed(uint256 indexed id, uint8 kind, address indexed proposer, bytes args, string reason)",
  "event Approved(uint256 indexed id, address indexed wallet)",
  "event Queued(uint256 indexed id, uint48 readyAt)",
  "event Executed(uint256 indexed id)",
  "event Cancelled(uint256 indexed id, address by)",
  "event RoleReplaced(uint8 indexed role, address indexed oldHolder, address indexed newHolder)",
  "event NotePaused(address indexed token, bool paused)",
  // A note's token
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  // Its Determination Agent
  "event Determined(uint256 indexed dateIndex, uint256[] levels, (bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex) outcome)",
  "event Corrected(uint256 indexed dateIndex, uint256[] levels, (bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex) outcome)",
  // Its Paying Agent
  "event Opened(bytes32 indexed id, uint256 indexed dateIndex, uint8 kind, uint256 perCa, uint256 unitsEntitled)",
  "event Paid(bytes32 indexed id, address indexed holder, uint256 units, uint256 amount)",
  "event Held(bytes32 indexed id, address indexed holder, uint256 units, uint256 amount)",
  "event Claimed(bytes32 indexed id, address indexed holder, uint256 amount)",
  "event Closed(bytes32 indexed id, uint256 unitsPaid, uint256 inventoryBurned)",
  "event Reversed(bytes32 indexed id, address indexed holder, uint256 recovered, uint256 cancelledHeld, uint256 shortfall)",
  "event DistributionReversed(bytes32 indexed id, string reason)",
  "event Restated(bytes32 indexed original, bytes32 indexed restatement, uint48 recordTime, string reason)",
  // Its settlement
  "event Offered(uint256 indexed id, address indexed proposer, address indexed counterparty, uint8 side, uint256 units, uint256 price, uint256 deadline)",
  "event Settled(uint256 indexed id, address indexed seller, address indexed buyer, uint256 units, uint256 price)",
  "event Released(uint256 indexed id, address by)",
]);
const FACTORY = parseAbi([
  "function notes() view returns (address[])",
  "function noteOf(address token) view returns ((uint256 series, address token, address identity, address identityRegistry, address compliance, address trustedIssuers, address claimTopics, address determinations, address recordDates, address payingAgent, address settlement, address inventory))",
]);

/** Blocks read per query: within what the ledger RPC answers, and few enough queries for a long history. */
const SPAN = 20_000n;
/** Blocks left to settle on a public network before they are indexed. */
const SETTLE = 3n;
/** How long the index is trusted as current within one server, before it looks for new blocks again. */
const FRESH_MS = 3_000;

const plain = (v: unknown): unknown =>
  typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(plain) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v;

let known: { factory: string; tokens: number; owners: Map<string, string> } | null = null;

/**
 * Which note each of the programme's contracts belongs to, from the factory's own record. Kept
 * between reads, and only the notes issued since are looked up.
 */
async function contractsOfNotes(c: PublicClient, factory: Address): Promise<Map<string, string>> {
  const tokens = await c.readContract({ address: factory, abi: FACTORY, functionName: "notes" });
  if (known?.factory !== factory.toLowerCase()) known = { factory: factory.toLowerCase(), tokens: 0, owners: new Map() };
  const records = await Promise.all(tokens.slice(known.tokens).map((t) => c.readContract({ address: factory, abi: FACTORY, functionName: "noteOf", args: [t] })));
  for (const r of records) for (const a of [r.token, r.determinations, r.payingAgent, r.settlement]) known.owners.set(a.toLowerCase(), r.token.toLowerCase());
  known.tokens = tokens.length;
  return new Map(known.owners);
}

let lastSync = 0;
let syncing: Promise<number> | null = null;

/**
 * Reads the blocks the index has not yet read, and adds their events. Returns the last block it now
 * holds. Called before the index is read; within a few seconds of the last call it returns at once.
 */
export async function syncIndex(force = false): Promise<number> {
  if (!force && Date.now() - lastSync < FRESH_MS && syncing === null) return -1;
  syncing ??= sync().finally(() => {
    lastSync = Date.now();
    syncing = null;
  });
  return syncing;
}

async function sync(): Promise<number> {
  const m = loadManifest();
  const deployment = currentDeployment();
  const factory = m.identity?.noteFactory as Address | undefined;
  const controller = m.governance?.controller as Address | undefined;
  if (!deployment || !factory) return -1;
  const store = getStore();
  const c = client(m);
  const key = `index:${deployment}`;
  const holder = randomUUID();
  const lease = await store.takeLease(key, holder, 120_000);
  if (!lease) return -1; // another server is reading: its events land shortly
  let cursor = lease.block === undefined ? (await deploymentBlock(c, m)) - 1n : BigInt(String(lease.block));
  try {
    const head = await c.getBlockNumber();
    const local = m.chainId === 31337;
    const to = local ? head : head - SETTLE;
    if (to <= cursor) return Number(cursor);
    const owners = await contractsOfNotes(c, factory);
    const times = new Map<bigint, number>();
    while (cursor < to) {
      const from = cursor + 1n;
      const end = from + SPAN - 1n < to ? from + SPAN - 1n : to;
      const addresses = [factory, ...(controller ? [controller] : []), ...([...owners.keys()] as Address[])];
      const logs = (await c.getLogs({ address: addresses, events: EVENTS, fromBlock: from, toBlock: end, strict: false })) as Array<Log & { eventName?: string; args?: Record<string, unknown> }>;
      // A note issued in this range: its own contracts' events in the same range are read too.
      const issued = logs.filter((l) => l.eventName === "NoteIssued" && l.address.toLowerCase() === factory.toLowerCase());
      const fresh: Address[] = [];
      for (const l of issued) {
        const n = l.args!.note as Record<string, Address>;
        for (const a of [n.token, n.determinations, n.payingAgent, n.settlement]) {
          if (!owners.has(a.toLowerCase())) fresh.push(a);
          owners.set(a.toLowerCase(), n.token.toLowerCase());
        }
      }
      if (fresh.length) logs.push(...((await c.getLogs({ address: fresh, events: EVENTS, fromBlock: from, toBlock: end, strict: false })) as typeof logs));
      const decoded = logs.filter((l) => l.eventName && l.blockNumber !== null && l.logIndex !== null);
      for (const b of new Set(decoded.map((l) => l.blockNumber!))) {
        if (!times.has(b)) times.set(b, Number((await c.getBlock({ blockNumber: b })).timestamp));
      }
      const rows: IndexedEvent[] = decoded.map((l) => {
        const address = l.address.toLowerCase();
        const args = plain(l.args ?? {}) as Record<string, unknown>;
        // The factory's and the controller's events about a note belong to it.
        const about = typeof args.token === "string" ? args.token.toLowerCase() : null;
        return {
          id: `${l.blockNumber}:${l.logIndex}`,
          block: Number(l.blockNumber),
          logIndex: l.logIndex!,
          tx: l.transactionHash!,
          address,
          note: owners.get(address) ?? about,
          name: l.eventName!,
          args,
          at: times.get(l.blockNumber!)!,
        };
      });
      await store.putEvents(deployment, rows);
      cursor = end;
      // Each range is kept as it is read: a long first read that is cut short is not read again.
      await store.releaseLease(key, holder, { block: cursor.toString() });
      if (!(await store.takeLease(key, holder, 120_000))) return Number(cursor);
    }
    return Number(cursor);
  } finally {
    await store.releaseLease(key, holder, { block: cursor.toString() }).catch(() => undefined);
  }
}

/**
 * The index's events matching `q`, read once the index has caught up with the chain: with `fresh`,
 * whatever the last look found, as after a transaction this request sent.
 */
export async function indexed(q: EventQuery & { fresh?: boolean }): Promise<IndexedEvent[]> {
  const deployment = currentDeployment();
  if (!deployment) return [];
  const { fresh, ...query } = q;
  await syncIndex(fresh);
  return getStore().events(deployment, query);
}
