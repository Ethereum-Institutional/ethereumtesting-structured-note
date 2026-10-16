import "server-only";
import { randomBytes } from "node:crypto";
import { keccak256, parseAbi, parseAbiItem, toBytes, type Address, type Hex } from "viem";
import { addressBook } from "../chain/manifest.ts";
import { until } from "../chain/until.ts";
import { client, deploymentBlock, noteContracts, withCustodyAccounts } from "../ledger.ts";
import { getStore } from "../store.ts";
import { context } from "./onchain.ts";
import { accountNamer } from "./names.ts";

/**
 * The bank's tokenized deposit (ADRs 0086, 0092): credits and debits through the deposit gateway,
 * each against a single-use booking reference the site assigns; holding part of a balance;
 * pausing the whole deposit; and moving it by order with a written reason. And the bank's view of
 * it: the supply, every holder and why it may hold, and every booking, read from the chain.
 */

// The deposit's own refusals, which pass up through the gateway, so they are named either way.
const REFUSALS = [
  "error ERC7943CannotSend(address account)",
  "error ERC7943CannotReceive(address account)",
  "error ERC7943InsufficientUnfrozenBalance(address account, uint256 amount, uint256 unfrozen)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error EnforcedPause()",
  "error NoReason()",
  "error InvalidAccount()",
  "error ReferenceUsed(bytes32 bookingRef)",
  "error ZeroReference()",
] as const;
const GATEWAY = parseAbi([
  "function credit(address account, uint256 amount, bytes32 bookingRef)",
  "function debit(address account, uint256 amount, bytes32 bookingRef)",
  ...REFUSALS,
]);
const TOKEN = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function paused() view returns (bool)",
  "function getFrozenTokens(address) view returns (uint256)",
  "function allowlisted(address) view returns (bool)",
  "function canReceive(address) view returns (bool)",
  "function setFrozenTokens(address account, uint256 amount) returns (bool)",
  "function pause()",
  "function unpause()",
  "function enforce(address from, address to, uint256 amount, string reason) returns (bool)",
  ...REFUSALS,
]);
const REGISTRY = parseAbi(["function isVerified(address) view returns (bool)"]);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const CREDITED = parseAbiItem("event Credited(address indexed account, uint256 amount, bytes32 indexed bookingRef)");
const DEBITED = parseAbiItem("event Debited(address indexed account, uint256 amount, bytes32 indexed bookingRef)");
const ENFORCED = parseAbiItem("event Enforced(address indexed from, address indexed to, uint256 amount, string reason)");

export function depositToken(): { address: Address; symbol: string; decimals: number } {
  const { m } = context();
  const t = m.assets.deposit;
  if (!t) throw new Error("the manifest has no deposit");
  return t;
}

/** A booking reference the site assigns: single-use at the gateway, which records only its hash. */
const newBooking = () => `BKG-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${randomBytes(4).toString("hex").toUpperCase()}`;

/** The deposit's refusal, in words. */
function refusal(e: unknown): Error {
  const text = String((e as Error)?.message ?? e);
  if (/EnforcedPause/.test(text)) return new Error("The deposit is paused: resume it first.");
  if (/ERC7943InsufficientUnfrozenBalance|ERC20InsufficientBalance/.test(text)) return new Error("The account does not hold that much free of any hold.");
  if (/ERC7943CannotReceive/.test(text)) return new Error("The receiving account cannot hold the deposit: the bank has not vouched for it.");
  if (/ReferenceUsed/.test(text)) return new Error("That booking reference was used already.");
  return e as Error;
}

export async function creditDeposit(account: Address, amount: bigint): Promise<{ tx: Hex; bookingRef: string }> {
  const { m, s } = context();
  if (amount <= 0n) throw new Error("the amount must be more than zero");
  const bookingRef = newBooking();
  const tx = await s.send("depositAgent", { address: m.instruments!.gateway, abi: GATEWAY, functionName: "credit", args: [account, amount, keccak256(toBytes(bookingRef))] }).catch((e) => { throw refusal(e); });
  return { tx, bookingRef };
}

/** The bank pays a client's deposit back out to its account at the bank: the gateway extinguishes it, against a booking. */
export async function debitDeposit(account: Address, amount: bigint): Promise<{ tx: Hex; bookingRef: string }> {
  const { m, s } = context();
  if (amount <= 0n) throw new Error("the amount must be more than zero");
  const bookingRef = newBooking();
  const tx = await s.send("depositAgent", { address: m.instruments!.gateway, abi: GATEWAY, functionName: "debit", args: [account, amount, keccak256(toBytes(bookingRef))] }).catch((e) => { throw refusal(e); });
  return { tx, bookingRef };
}

/** The bank holds part of an account's balance (ERC-7943): `amount` is the whole amount held from now; zero releases it. */
export async function holdDeposit(account: Address, amount: bigint): Promise<Hex> {
  const { s } = context();
  if (amount < 0n) throw new Error("the amount cannot be negative");
  const tx = await s.send("depositAgent", { address: depositToken().address, abi: TOKEN, functionName: "setFrozenTokens", args: [account, amount] });
  await until(() => s.publicClient.readContract({ address: depositToken().address, abi: TOKEN, functionName: "getFrozenTokens", args: [account] }), (v) => v === amount);
  return tx;
}

/** The bank stops every movement of its deposit, or resumes it. */
export async function setPaused(paused: boolean): Promise<Hex> {
  const { s } = context();
  const address = depositToken().address;
  if ((await s.publicClient.readContract({ address, abi: TOKEN, functionName: "paused" })) === paused) throw new Error(paused ? "The deposit is paused already." : "The deposit is not paused.");
  const tx = await s.send("depositAgent", { address, abi: TOKEN, functionName: paused ? "pause" : "unpause", args: [] });
  await until(() => s.publicClient.readContract({ address, abi: TOKEN, functionName: "paused" }), (v) => v === paused);
  return tx;
}

/** The bank moves its deposit by order, with its written reason on-chain (ADR 0092). */
export async function enforce(from: Address, to: Address, amount: bigint, reason: string): Promise<Hex> {
  const { s } = context();
  if (!reason.trim()) throw new Error("Give the order and its reason.");
  if (amount <= 0n) throw new Error("the amount must be more than zero");
  return s.send("depositAgent", { address: depositToken().address, abi: TOKEN, functionName: "enforce", args: [from, to, amount, reason.trim()] }).catch((e) => { throw refusal(e); });
}

export function depositBalance(account: Address): Promise<bigint> {
  const { s } = context();
  return s.publicClient.readContract({ address: depositToken().address, abi: TOKEN, functionName: "balanceOf", args: [account] });
}

// ---------------------------------------------------------------------------------------------
// The bank's view
// ---------------------------------------------------------------------------------------------

export type Holder = {
  account: Address;
  /** The deployment's or the site's name for it, where it has one. */
  label: string | null;
  /** The onboarding the site holds for it, for acting on it. */
  admission: string | null;
  balance: bigint;
  held: bigint;
  /** Why it may hold the deposit: the bank's claim through the registry, or the allowlist. */
  why: "identity" | "allowlist" | null;
};
export type Booking = { kind: "credit" | "debit"; account: Address; label: string | null; amount: bigint; ref: string | null; refHash: Hex; tx: Hex; block: number };
export type Enforcement = { from: Address; to: Address; fromLabel: string | null; toLabel: string | null; amount: bigint; reason: string; tx: Hex; block: number };
export type DepositView = { symbol: string; decimals: number; supply: bigint; paused: boolean; holders: Holder[]; bookings: Booking[]; enforcements: Enforcement[] };

export async function depositView(): Promise<DepositView> {
  const { m, id } = context();
  const t = depositToken();
  const c = client(m);
  const from = await deploymentBlock(c, m);
  // One block for every read, logs and state alike, so the view is one moment of the chain.
  const at = await c.getBlockNumber();
  const gateway = m.instruments!.gateway as Address;
  const [transfers, credited, debited, enforced, withCustody, notes, admissions] = await Promise.all([
    c.getLogs({ address: t.address, event: TRANSFER, fromBlock: from, toBlock: at }),
    c.getLogs({ address: gateway, event: CREDITED, fromBlock: from, toBlock: at }),
    c.getLogs({ address: gateway, event: DEBITED, fromBlock: from, toBlock: at }),
    c.getLogs({ address: t.address, event: ENFORCED, fromBlock: from, toBlock: at }),
    withCustodyAccounts(c, m, from),
    noteContracts(),
    getStore().listAdmissions(1000),
  ]);
  const audit = await getStore().auditLog(5000);

  // Names: the deployment's, the site's notes' contracts, and the clients the site onboarded.
  const names = new Map<string, string>();
  for (const [a, v] of addressBook(withCustody)) names.set(a, v.label);
  for (const n of notes) names.set(n.address.toLowerCase(), n.label);
  const onboarding = new Map<string, { id: string; name: string }>();
  const refs = new Map<string, string>();
  const nameOf = await accountNamer();
  for (const a of admissions) {
    const d = a.data as Record<string, any>;
    if (d.wallet && !onboarding.has(String(d.wallet).toLowerCase())) onboarding.set(String(d.wallet).toLowerCase(), { id: a.id, name: nameOf(a) });
    for (const b of [...(d.credits ?? []), ...(d.debits ?? [])]) if (b.bookingRef) refs.set(keccak256(toBytes(b.bookingRef)).toLowerCase(), b.bookingRef);
  }
  // Every booking the site made carries its reference in the audit log, whoever it was for.
  for (const e of audit) for (const r of e.action.match(/BKG-[0-9]{6}-[0-9A-F]{8}/g) ?? []) refs.set(keccak256(toBytes(r)).toLowerCase(), r);
  const label = (a: Address) => onboarding.get(a.toLowerCase())?.name || names.get(a.toLowerCase()) || null;

  const seen = new Map<string, Address>();
  for (const l of transfers) if (l.args.to && !/^0x0{40}$/i.test(l.args.to)) seen.set(l.args.to.toLowerCase(), l.args.to);
  const read = <T>(functionName: "balanceOf" | "getFrozenTokens" | "allowlisted", account: Address) =>
    c.readContract({ address: t.address, abi: TOKEN, functionName, args: [account], blockNumber: at }) as Promise<T>;
  const holders = await Promise.all(
    [...seen.values()].map(async (account): Promise<Holder> => {
      const [balance, held, listed, verified] = await Promise.all([
        read<bigint>("balanceOf", account),
        read<bigint>("getFrozenTokens", account),
        read<boolean>("allowlisted", account),
        c.readContract({ address: id.depositRegistry, abi: REGISTRY, functionName: "isVerified", args: [account], blockNumber: at }).catch(() => false),
      ]);
      return { account, label: label(account), admission: onboarding.get(account.toLowerCase())?.id ?? null, balance, held, why: verified ? "identity" : listed ? "allowlist" : null };
    }),
  );
  holders.sort((x, y) => (y.balance > x.balance ? 1 : y.balance < x.balance ? -1 : 0));

  const bookings: Booking[] = [
    ...credited.map((l) => ({ kind: "credit" as const, l })),
    ...debited.map((l) => ({ kind: "debit" as const, l })),
  ]
    .map(({ kind, l }) => ({
      kind,
      account: l.args.account!,
      label: label(l.args.account!),
      amount: l.args.amount!,
      refHash: l.args.bookingRef!,
      ref: refs.get(l.args.bookingRef!.toLowerCase()) ?? null,
      tx: l.transactionHash!,
      block: Number(l.blockNumber),
    }))
    .sort((x, y) => y.block - x.block);
  const enforcements = enforced
    .map((l) => ({ from: l.args.from!, to: l.args.to!, fromLabel: label(l.args.from!), toLabel: label(l.args.to!), amount: l.args.amount!, reason: l.args.reason!, tx: l.transactionHash!, block: Number(l.blockNumber) }))
    .sort((x, y) => y.block - x.block);

  const [supply, paused] = await Promise.all([
    c.readContract({ address: t.address, abi: TOKEN, functionName: "totalSupply", blockNumber: at }),
    c.readContract({ address: t.address, abi: TOKEN, functionName: "paused", blockNumber: at }),
  ]);
  return { symbol: t.symbol, decimals: t.decimals, supply, paused, holders: holders.filter((h) => h.balance > 0n || h.held > 0n), bookings, enforcements };
}
