import "server-only";
import { defineChain, formatEther, parseEther, type Address, type Hex } from "viem";
import { loadManifest } from "./manifest.ts";
import { CAPACITY_LABEL, SIGNS_ONLY, feeBuffer, signers } from "./signer.ts";
import { getStore, type Registrant } from "../store.ts";
import { isOperator } from "../operators.ts";
import { until } from "./until.ts";

/**
 * The keys the site signs with, and their ETH for fees (ADR 0080): every capacity's balance, which
 * are low, and topping one up from the best-funded key.
 */

/** What a top-up sends. */
export const TOP_UP = parseEther(process.env.TOP_UP_ETH?.trim() || "0.003");
/** Gas of a typical transaction here, for "about N transactions left". */
const TYPICAL_GAS = 300_000n;
const CACHE_MS = 30_000;

function context() {
  const m = loadManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, s: signers(chain, rpc) };
}

export type KeyRow = {
  capacity: string;
  label: string;
  address: Address;
  balance: bigint;
  signsOnly: boolean;
  /** Transactions of typical size the balance pays for at today's fees. */
  transactionsLeft: number | null;
  state: "ok" | "low" | "empty" | "signs-only";
};
export type KeysView = { chainId: number; rows: KeyRow[]; buffer: bigint; gasPrice: bigint; funder: KeyRow | null; readAt: string };

let cache: { at: number; value: KeysView } | null = null;

/** Every key the site holds, with its balance. Cached for half a minute: every Operator page reads it. */
export async function keyBalances(fresh = false): Promise<KeysView> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const { m, s } = context();
  const buffer = feeBuffer();
  const capacities = s.capacities().filter((c) => !c.startsWith("investor"));
  const [gasPrice, balances] = await Promise.all([
    s.publicClient.getGasPrice(),
    Promise.all(capacities.map((c) => s.publicClient.getBalance({ address: s.address(c) }))),
  ]);
  const rows: KeyRow[] = capacities.map((capacity, i) => {
    const balance = balances[i];
    const signsOnly = SIGNS_ONLY.has(capacity);
    const per = TYPICAL_GAS * (gasPrice || 1n);
    return {
      capacity,
      label: CAPACITY_LABEL[capacity] ?? capacity,
      address: s.address(capacity),
      balance,
      signsOnly,
      transactionsLeft: signsOnly ? null : Number(balance / per),
      state: signsOnly ? "signs-only" : balance < per * 2n ? "empty" : balance < buffer ? "low" : "ok",
    };
  });
  const funder = rows.filter((r) => !r.signsOnly).sort((a, b) => (a.balance < b.balance ? 1 : -1))[0] ?? null;
  const value = { chainId: m.chainId, rows, buffer, gasPrice, funder, readAt: new Date().toISOString() };
  cache = { at: Date.now(), value };
  return value;
}

/** The keys below the buffer, for the warning on every Operator page. Never throws. */
export async function lowKeys(): Promise<KeyRow[]> {
  try {
    return (await keyBalances()).rows.filter((r) => r.state === "low" || r.state === "empty");
  } catch {
    return [];
  }
}

/**
 * Staff top up a key from the best-funded one (ADR 0080), which must keep the buffer itself
 * afterwards.
 */
export async function topUp(staff: Registrant, capacity: string): Promise<Hex> {
  if (!isOperator(staff.email)) throw new Error("Not permitted.");
  const view = await keyBalances(true);
  const target = view.rows.find((r) => r.capacity === capacity);
  if (!target) throw new Error("The site holds no such key.");
  if (target.signsOnly) throw new Error(`The ${target.label} only signs; it needs no ETH.`);
  const funder = view.rows.filter((r) => !r.signsOnly && r.capacity !== capacity).sort((a, b) => (a.balance < b.balance ? 1 : -1))[0];
  if (!funder || funder.balance < TOP_UP + view.buffer) {
    throw new Error(
      `No key holds enough to top up from: the best-funded, the ${funder?.label ?? "none"}, holds ${formatEther(funder?.balance ?? 0n)} ETH. ` +
        `Fund it from a faucet first.`,
    );
  }
  const { s } = context();
  const tx = await s.transfer(funder.capacity, target.address, TOP_UP);
  // Cached only once the new balance is visible: a lagging RPC would otherwise cache the old one.
  await until(() => s.publicClient.getBalance({ address: target.address }), (v) => v >= target.balance + TOP_UP);
  cache = null;
  await getStore().audit({
    at: new Date().toISOString(),
    actor: staff.email,
    action: `topped up the ${target.label}'s key ${target.address} with ${formatEther(TOP_UP)} ETH from the ${funder.label}'s`,
    subject: tx,
  });
  return tx;
}
