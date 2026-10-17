import "server-only";
import { parseAbi, type Address } from "viem";
import { notesOnRecord, chainClient, type NoteOnRecord } from "./registry.ts";
import { getStore, type Job } from "../store.ts";
import { indexed } from "../chain/events.ts";

/**
 * The book (workstream 9): every note the programme has issued, on one page, with what each needs
 * next. Read from the chain's current state, the index of the programme's events and the jobs, so
 * the desk sees at a glance what is due, what is running and what waits for a second approver.
 */

const OUTCOME = "(bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex)";
const DETERMINATIONS = parseAbi([
  "function nextDate() view returns (uint256)",
  "function terminated() view returns (bool)",
  "function observationCount() view returns (uint256)",
  "function observation(uint256 dateIndex) view returns ((uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps))",
  `function outcomeOf(uint256 dateIndex) view returns (${OUTCOME})`,
]);
const PAYING = parseAbi([
  "function idOf(uint256 dateIndex, uint8 kind) pure returns (bytes32)",
  "function distributions(bytes32 id) view returns (uint48 recordTime, uint64 perCa, uint64 unitsEntitled, uint64 unitsPaid, bool open, bool closed, uint8 kind, bool reversed, uint64 unitsReversed, uint256 dateIndex)",
  "function INVENTORY() view returns (address)",
]);
const TOKEN = parseAbi(["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function paused() view returns (bool)"]);

export type NextAct =
  | { kind: "determine"; date: number; at: number; due: boolean }
  | { kind: "pay"; date: number; event: "coupon" | "redemption"; at: number; due: boolean }
  | { kind: "none"; reason: string };

export type BookRow = {
  token: Address;
  name: string;
  symbol: string;
  series: number;
  isin: string;
  /** The site's page for the note, where the site issued it; otherwise its statement. */
  href: string;
  status: "live" | "redeemed" | "closed" | "retired";
  outstanding: string;
  inventory: string;
  paused: boolean;
  dates: number;
  datesDetermined: number;
  next: NextAct;
  awaitingApproval: Job[];
  running: Job[];
  failed: Job[];
};

export type Book = {
  chainNow: number;
  rows: BookRow[];
  totals: { notes: number; live: number; outstanding: bigint; due: number; awaitingApproval: number; running: number; failed: number };
};

async function rowOf(n: NoteOnRecord, chainNow: number, jobs: Job[], retired: Set<string>): Promise<BookRow> {
  const { c } = chainClient();
  const da = n.note.addresses.determinations as Address;
  const pa = n.note.addresses.payingAgent as Address;
  const [next, terminated, count, supply, paused, inventoryAddress] = await Promise.all([
    c.readContract({ address: da, abi: DETERMINATIONS, functionName: "nextDate" }),
    c.readContract({ address: da, abi: DETERMINATIONS, functionName: "terminated" }),
    c.readContract({ address: da, abi: DETERMINATIONS, functionName: "observationCount" }),
    c.readContract({ address: n.token, abi: TOKEN, functionName: "totalSupply" }),
    c.readContract({ address: n.token, abi: TOKEN, functionName: "paused" }),
    c.readContract({ address: pa, abi: PAYING, functionName: "INVENTORY" }),
  ]);
  const inventory = await c.readContract({ address: n.token, abi: TOKEN, functionName: "balanceOf", args: [inventoryAddress] });

  // What the note needs next: paying the latest date determined, if anything of it is unpaid; else
  // determining the next date.
  let act: NextAct = { kind: "none", reason: "Nothing left to do" };
  if (next > 0n) {
    const k = next - 1n;
    const [o, obs] = await Promise.all([
      c.readContract({ address: da, abi: DETERMINATIONS, functionName: "outcomeOf", args: [k] }),
      c.readContract({ address: da, abi: DETERMINATIONS, functionName: "observation", args: [k] }),
    ]);
    for (const [event, owed] of [["coupon", o.couponPaid], ["redemption", o.redeemed]] as const) {
      if (!owed || act.kind === "pay") continue;
      const id = await c.readContract({ address: pa, abi: PAYING, functionName: "idOf", args: [k, event === "coupon" ? 0 : 1] });
      const d = await c.readContract({ address: pa, abi: PAYING, functionName: "distributions", args: [id] });
      if (!d[5]) act = { kind: "pay", date: Number(k), event, at: Number(obs.paymentDate), due: chainNow >= Number(obs.paymentDate) };
    }
  }
  if (act.kind === "none" && !terminated && next < count) {
    const obs = await c.readContract({ address: da, abi: DETERMINATIONS, functionName: "observation", args: [next] });
    act = { kind: "determine", date: Number(next), at: Number(obs.date), due: chainNow >= Number(obs.date) };
  }
  if (act.kind === "none" && terminated) act = { kind: "none", reason: supply === 0n ? "Redeemed and closed" : "Redeemed" };

  const mine = jobs.filter((j) => j.subject === n.note.id);
  const status: BookRow["status"] = retired.has(n.token.toLowerCase()) ? "retired" : terminated && supply === 0n ? "closed" : terminated ? "redeemed" : "live";
  return {
    token: n.token,
    name: n.name,
    symbol: n.symbol,
    series: n.series,
    isin: n.isin,
    href: n.note.id.startsWith("note_") ? `/agent/notes/${n.note.id}` : `/agent/reconciliation/${n.token}`,
    status,
    outstanding: String(supply),
    inventory: String(inventory),
    paused,
    dates: Number(count),
    datesDetermined: Number(next),
    next: act,
    awaitingApproval: mine.filter((j) => j.state === "awaiting approval"),
    running: mine.filter((j) => j.state === "queued"),
    failed: mine.filter((j) => j.state === "failed"),
  };
}

/** The whole book, in series order. */
export async function bookView(): Promise<Book> {
  const { m, c } = chainClient();
  const [notes, block, jobs, retiredEvents] = await Promise.all([
    notesOnRecord(),
    c.getBlock(),
    getStore().listJobs(1000),
    m.identity?.noteFactory ? indexed({ addresses: [m.identity.noteFactory], names: ["Retired"] }) : Promise.resolve([]),
  ]);
  const chainNow = Number(block.timestamp);
  const retired = new Set(retiredEvents.map((e) => String(e.args.token).toLowerCase()));
  const rows = (await Promise.all(notes.map((n) => rowOf(n, chainNow, jobs, retired)))).sort((a, b) => a.series - b.series);
  return {
    chainNow,
    rows,
    totals: {
      notes: rows.length,
      live: rows.filter((r) => r.status === "live").length,
      outstanding: rows.reduce((t, r) => t + BigInt(r.outstanding), 0n),
      due: rows.filter((r) => (r.next.kind === "determine" || r.next.kind === "pay") && r.next.due).length,
      awaitingApproval: rows.reduce((t, r) => t + r.awaitingApproval.length, 0),
      running: rows.reduce((t, r) => t + r.running.length, 0),
      failed: rows.reduce((t, r) => t + r.failed.length, 0),
    },
  };
}
