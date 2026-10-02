import "server-only";
import { createPublicClient, defineChain, http, parseAbi, parseAbiItem, type Address } from "viem";
import { loadManifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";
import { type DemoNote } from "../store.ts";
import { lifecycleOf } from "./lifecycle.ts";
import { lockedSettlement, offersOf } from "./place.ts";

/**
 * A note's close-out statement (S-33, ADR 0084): supply zero, the holder list empty, every
 * distribution paid in full with nothing held, nothing left in the Paying Agent or the settlement
 * contract, and every account's position reconciled from its first unit to zero. Read from the
 * chain alone, at one block, so anyone with the chain can reproduce it.
 */

const NOTE = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function paused() view returns (bool)",
  "function getFrozenTokens(address) view returns (uint256)",
]);
const CASH = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ZERO = "0x0000000000000000000000000000000000000000";

export type Check = { label: string; ok: boolean; detail: string };
export type Position = {
  account: Address;
  /** Units received: by issuance, placement or transfer. */
  unitsIn: string;
  /** Units given up: by transfer, buy-back or redemption. */
  unitsOut: string;
  balance: string;
  couponCents: string;
  redemptionCents: string;
  heldCents: string;
};
export type CloseOut = {
  note: { id: string; name: string; symbol: string; address: Address };
  chainId: number;
  block: string;
  at: string;
  closed: boolean;
  checks: Check[];
  positions: Position[];
  totals: { couponCents: string; redemptionCents: string; heldCents: string; units: string };
};

function context() {
  const m = loadManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const logs = createPublicClient({ chain, transport: http(process.env.LEDGER_RPC_URL?.trim() || rpc) });
  return { m, s: signers(chain, rpc), logs };
}

const euros = (cents: bigint) => `€${(Number(cents) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

export async function closeOutOf(n: DemoNote): Promise<CloseOut> {
  const { m, s, logs } = context();
  const c = s.publicClient;
  const note = n.addresses.note as Address;
  const deposit = m.assets.deposit!.address as Address;
  const block = await c.getBlock();
  const at = { blockNumber: block.number };
  const fromBlock = n.txs.note ? (await c.getTransactionReceipt({ hash: n.txs.note as `0x${string}` }).catch(() => null))?.blockNumber ?? 0n : 0n;

  const [supply, paused, life, transfers, offers, agentCash, settlementCash] = await Promise.all([
    c.readContract({ address: note, abi: NOTE, functionName: "totalSupply", ...at }),
    c.readContract({ address: note, abi: NOTE, functionName: "paused", ...at }),
    lifecycleOf(n),
    logs.getLogs({ address: note, event: TRANSFER, fromBlock, toBlock: block.number }),
    lockedSettlement(n) ? offersOf(n) : Promise.resolve([]),
    c.readContract({ address: deposit, abi: CASH, functionName: "balanceOf", args: [n.addresses.payingAgent as Address], ...at }),
    n.addresses.settlement ? c.readContract({ address: deposit, abi: CASH, functionName: "balanceOf", args: [n.addresses.settlement as Address], ...at }) : Promise.resolve(0n),
  ]);

  // Every account the note ever moved to or from, and what it received and gave up.
  const flows = new Map<string, { in: bigint; out: bigint }>();
  const flow = (a: string) => flows.get(a.toLowerCase()) ?? flows.set(a.toLowerCase(), { in: 0n, out: 0n }).get(a.toLowerCase())!;
  for (const l of transfers) {
    const { from, to, value } = l.args as { from: Address; to: Address; value: bigint };
    if (to.toLowerCase() !== ZERO) flow(to).in += value;
    if (from.toLowerCase() !== ZERO) flow(from).out += value;
  }
  const accounts = [...flows.keys()] as Address[];
  const balances = await Promise.all(accounts.map((a) => c.readContract({ address: note, abi: NOTE, functionName: "balanceOf", args: [a], ...at })));
  const frozen = await Promise.all(accounts.map((a) => c.readContract({ address: note, abi: NOTE, functionName: "getFrozenTokens", args: [a], ...at }).catch(() => 0n)));

  // What each was paid, coupon by coupon, and anything still held for it.
  const paid = new Map<string, { coupon: bigint; redemption: bigint; held: bigint }>();
  const pay = (a: string) => paid.get(a.toLowerCase()) ?? paid.set(a.toLowerCase(), { coupon: 0n, redemption: 0n, held: 0n }).get(a.toLowerCase())!;
  const events = life.dates.flatMap((d) => d.events.map((e) => ({ date: d.index, ...e })));
  for (const e of events) {
    for (const p of e.payments) {
      if (p.held) pay(p.holder).held += BigInt(p.amount);
      else if (e.kind === "coupon") pay(p.holder).coupon += BigInt(p.amount);
      else pay(p.holder).redemption += BigInt(p.amount);
    }
  }

  const positions: Position[] = accounts.map((a, i) => {
    const f = flows.get(a)!;
    const p = paid.get(a) ?? { coupon: 0n, redemption: 0n, held: 0n };
    return { account: a, unitsIn: String(f.in), unitsOut: String(f.out), balance: String(balances[i]), couponCents: String(p.coupon), redemptionCents: String(p.redemption), heldCents: String(p.held) };
  });
  const sum = (k: "couponCents" | "redemptionCents" | "heldCents") => positions.reduce((t, p) => t + BigInt(p[k]), 0n);
  const totals = { couponCents: String(sum("couponCents")), redemptionCents: String(sum("redemptionCents")), heldCents: String(sum("heldCents")), units: String(positions.reduce((t, p) => t + BigInt(p.unitsIn), 0n) - positions.reduce((t, p) => t + BigInt(p.unitsOut), 0n)) };

  const holding = positions.filter((p) => p.balance !== "0");
  const unbalanced = positions.filter((p) => BigInt(p.unitsIn) - BigInt(p.unitsOut) !== BigInt(p.balance));
  const lockedAccounts = frozen.filter((f) => f > 0n).length;
  const open = events.filter((e) => !e.closed);
  const openOffers = offers.filter((o) => o.status === "offered");

  const checks: Check[] = [
    { label: "Supply is zero", ok: supply === 0n, detail: `${supply} units outstanding` },
    { label: "The note is redeemed", ok: life.terminated && paused, detail: life.terminated ? (paused ? "terminated and paused" : "terminated, not paused") : "not terminated" },
    { label: "The holder list is empty", ok: holding.length === 0, detail: holding.length ? `${holding.length} account(s) still hold units` : `all ${positions.length} accounts that held units hold none, the Issuer's inventory included` },
    { label: "Every position reconciles", ok: unbalanced.length === 0, detail: unbalanced.length ? `${unbalanced.length} account(s) whose units in less units out differ from their balance` : "for every account, units received less units given up equals its balance" },
    { label: "Every distribution is paid in full", ok: open.length === 0 && events.length > 0, detail: events.length === 0 ? "no distribution was made" : open.length ? `${open.length} distribution(s) not closed` : `${events.length} distribution(s), each closed with every entitled unit paid` },
    { label: "Nothing is held for a holder", ok: totals.heldCents === "0", detail: totals.heldCents === "0" ? "no payment awaits a holder" : `${euros(BigInt(totals.heldCents))} still held` },
    { label: "The Paying Agent holds no cash", ok: agentCash === 0n, detail: `${euros(agentCash)} of the deposit` },
    { label: "The settlement contract holds no cash", ok: settlementCash === 0n, detail: `${euros(settlementCash)} of the deposit` },
    { label: "No offer is open, and no unit is locked", ok: openOffers.length === 0 && lockedAccounts === 0, detail: openOffers.length || lockedAccounts ? `${openOffers.length} open offer(s), ${lockedAccounts} account(s) with locked units` : "none" },
  ];

  return {
    note: { id: n.id, name: n.name, symbol: n.symbol, address: note },
    chainId: m.chainId,
    block: String(block.number),
    at: new Date(Number(block.timestamp) * 1000).toISOString(),
    closed: checks.every((x) => x.ok),
    checks,
    positions,
    totals,
  };
}
