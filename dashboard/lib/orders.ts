import "server-only";
import fs from "node:fs";
import path from "node:path";
import { hasPostgres, dbInsertOrder, dbListOrders, dbClearOrders } from "./db";

/**
 * The order journal behind the trade tape.
 *
 * Settled orders are provable from the chain, but a rejected order never mines — the compliance
 * hook refuses it in simulation before any gas is spent — so the chain's log cannot show the
 * demo's best moment. This journal records every order attempt, either way: settled rows carry
 * the transaction hash that proves them, rejected rows carry the gate that stopped them.
 *
 * Storage follows the platform store's driver: Postgres when configured (a serverless host has
 * per-instance memory and a read-only filesystem, so anything less silently loses rows between
 * requests), otherwise a local file that survives dev-server reloads. Journal failures never
 * fail the order they describe — worst case the tape misses a row.
 */

export type OrderRecord = {
  id: string;
  at: string; // ISO timestamp
  who: string;
  direction: "buy" | "sell";
  amountIn: string;
  inSymbol: string;
  outSymbol: string;
  /** Amount received, settled orders only. */
  received?: string;
  ok: boolean;
  /** Plain-English rejection, failed orders only. */
  reason?: string;
  /** Mined transaction, settled orders only. */
  txHash?: string;
};

const FILE = path.join(process.cwd(), ".orders.json");
const CAP = 40;

let cache: OrderRecord[] = [];

/**
 * Always read the file: the page and the server actions are compiled into separate module
 * instances, so an in-memory cache written by one is invisible to the other. The memory copy
 * only serves as the store when the filesystem is read-only.
 */
function load(): OrderRecord[] {
  try {
    cache = JSON.parse(fs.readFileSync(FILE, "utf8")) as OrderRecord[];
  } catch {
    /* no file yet, or read-only fs: fall back to this instance's memory */
  }
  return cache;
}

function persist(rows: OrderRecord[]) {
  cache = rows;
  try {
    fs.writeFileSync(FILE, JSON.stringify(rows));
  } catch {
    /* read-only filesystem: memory-only is fine */
  }
}

export async function recordOrder(rec: Omit<OrderRecord, "id" | "at">): Promise<void> {
  const row: OrderRecord = {
    ...rec,
    id: `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
  };
  if (hasPostgres) {
    try {
      await dbInsertOrder(row);
      return;
    } catch (e) {
      console.error("order journal insert failed; falling back to file", e);
    }
  }
  const rows = load();
  rows.unshift(row);
  persist(rows.slice(0, CAP));
}

export async function recentOrders(limit = 12): Promise<OrderRecord[]> {
  if (hasPostgres) {
    try {
      return (await dbListOrders(limit)) as OrderRecord[];
    } catch (e) {
      console.error("order journal read failed; falling back to file", e);
    }
  }
  return load().slice(0, limit);
}

/** The demo reset rewinds the chain, which orphans every recorded order. */
export async function clearOrders(): Promise<void> {
  if (hasPostgres) {
    try {
      await dbClearOrders();
      return;
    } catch (e) {
      console.error("order journal clear failed", e);
    }
  }
  persist([]);
}
