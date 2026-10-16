import "server-only";
import { decodeAbiParameters, decodeErrorResult, defineChain, encodeFunctionData, keccak256, parseAbi, parseAbiItem, toBytes, type Address, type Hex } from "viem";
import { loadManifest, partyLabel, type Manifest } from "./chain/manifest.ts";
import { accountNamer } from "./identity/names.ts";
import { routeLabel } from "./routes.ts";
import { signers } from "./chain/signer.ts";
import { execThroughWallet } from "./chain/safe.ts";
import { until } from "./chain/until.ts";
import { ledgerFrom } from "./ledger.ts";
import { getStore, type Registrant } from "./store.ts";
import { hasRole } from "./operators.ts";

/**
 * The governance controller, from the site (ADRs 0082, 0088). It owns the deployment's own note and
 * its registries, and governs the Paying Agent and, where there is one, the venue; notes issued
 * from the site are the Issuer's to administer (ADR 0072).
 *
 * - **Tier 1** is the Agent's governance wallet alone, at once, with a written reason: correcting
 *   the register by forced transfer, recovering a lost wallet's units (S-25), freezing an account
 *   whichever institution vouched for it, and withdrawing or restoring pool access (ADR 0090).
 * - **Tier 2** is proposed and approved by the institutions' governance wallets: queued once at
 *   least two institutions approve with four signatures between their wallets (S-22), executable
 *   after the delay and, on a controller from ADR 0082, only within the execution window (S-24).
 * - **Each institution acts as itself.** Every act is its own 2-of-3 wallet's transaction, signed
 *   by two of its owners' keys the site holds and sent by the Agent's key. Each is first simulated
 *   from that wallet, so a refusal is the controller's own reason.
 * - **Acts offered** are those that cannot break the deployment: amending the notional, and
 *   trusting or ceasing to trust a claim issuer for the note. Replacing the servicing wallet or an
 *   institution, and reversing a distribution, are listed, not offered.
 */

const CONTROLLER = parseAbi([
  "function MIN_INSTITUTIONS() view returns (uint256)",
  "function MIN_SIGNATURES() view returns (uint256)",
  "function TIER2_DELAY() view returns (uint48)",
  "function RECOVERY_DELAY() view returns (uint48)",
  "function EXECUTION_WINDOW() view returns (uint48)",
  "function proposalCount() view returns (uint256)",
  "function proposal(uint256 id) view returns ((uint8 kind, address proposer, uint48 readyAt, bool executed, bool cancelled, bytes args, string reason))",
  "function approvals(uint256 id) view returns (uint256 institutionCount, uint256 signatures)",
  "function approvedBy(uint256 id, address wallet) view returns (bool)",
  "function expired(uint256 id) view returns (bool)",
  "function institutions() view returns (address[])",
  "function agentGovernance() view returns (address)",
  "function correctRegister(address from, address to, uint256 units, string reason)",
  "function freezeAccount(address account, bool frozen, string reason)",
  "function recoverWallet(address lostWallet, address newWallet, address identity, string reason)",
  "function withdrawPoolAccess(address account, string reason)",
  "function restorePoolAccess(address account, string reason)",
  "function proposeAmendNotional(bool increase, uint256 units, string reason) returns (uint256)",
  "function proposeSetTrustedIssuer(address issuer, uint256[] topics, string reason) returns (uint256)",
  "function TRUSTED_ISSUERS() view returns (address)",
  "function proposeSetLiquidityProvider(address account, bool approved, string reason) returns (uint256)",
  "function approve(uint256 id)",
  "function execute(uint256 id)",
  "function cancel(uint256 id)",
  "error InvalidConfiguration(string reason)",
  "error NotAgentGovernance(address caller)",
  "error NotAnInstitution(address caller)",
  "error NoReason()",
  "error UnknownProposal(uint256 id)",
  "error NotOpen(uint256 id)",
  "error AlreadyApproved(address wallet)",
  "error ThresholdsNotMet(uint256 institutions, uint256 signatures)",
  "error NotReady(uint48 readyAt)",
  "error NotCancellable(address caller)",
  "error TransfersClosed()",
  "error InvalidArgument()",
  "error NotServicingWallet(address caller)",
  "error NoVenue()",
  // The pool gate's, reached through the controller (ADR 0090).
  "error AlreadyWithdrawn(address account)",
  "error NotWithdrawn(address account)",
  "error Expired(uint256 id, uint48 expiredAt)",
]);
const TOKEN = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function isAgent(address agent) view returns (bool)",
  "function isFrozen(address account) view returns (bool)",
  "function identityRegistry() view returns (address)",
  "function getAgentRestrictions(address agent) view returns ((bool disableMint, bool disableBurn, bool disablePartialFreeze, bool disableAddressFreeze, bool disableRecovery, bool disableForceTransfer, bool disablePause))",
  "function forcedTransfer(address from, address to, uint256 amount) returns (bool)",
  "error AgentNotAuthorized(address agent, string reason)",
  "error CallerDoesNotHaveAgentRole()",
  "error UnverifiedIdentity()",
  "error ComplianceNotFollowed()",
]);
const REGISTRY = parseAbi(["function identity(address wallet) view returns (address)"]);
const ISSUERS = parseAbi(["function getTrustedIssuers() view returns (address[])"]);
const TIER1 = parseAbiItem("event Tier1(string action, string reason)");
/** The note-eligible claim topic (ADR 0088). */
const NOTE_TOPIC = BigInt(keccak256(toBytes("claim.note-eligible")));

/** The controller's kinds of Tier 2 proposal, in its enum's order. */
export const KINDS = [
  "AmendNotional",
  "ReverseDistribution",
  "RestateDistribution",
  "SetTrustedIssuer",
  "ReplaceServicingWallet",
  "ReplaceInstitution",
  "SetCredentialGate",
  "SetLiquidityProvider",
  "SetVenueWrapper",
  "SetVenueHook",
  "SetPoolIssuer",
] as const;
export type Kind = (typeof KINDS)[number];
/** Offered from the site; the rest could break the deployment if misused (ADR 0082). */
export const OFFERED: Kind[] = ["AmendNotional", "SetTrustedIssuer", "SetLiquidityProvider"];
export const KIND_LABEL: Record<Kind, string> = {
  AmendNotional: "Amend the notional in the Issuer's inventory",
  ReverseDistribution: "Reverse a distribution",
  RestateDistribution: "Restate a distribution",
  SetTrustedIssuer: "Trust a claim issuer for the note, or cease to",
  ReplaceServicingWallet: "Replace the Agent's servicing wallet",
  ReplaceInstitution: "Replace an institution's wallet (recovery)",
  SetCredentialGate: "Point the pool at a new gate",
  SetLiquidityProvider: "Approve or remove a liquidity provider",
  SetVenueWrapper: "Allow or refuse a router or position manager",
  SetVenueHook: "Allow or refuse a hook",
  SetPoolIssuer: "Trust a claim issuer to vouch for pool access, or cease to",
};

export type InstitutionKey = "agent" | "issuer" | "cosigner";
const INSTITUTIONS: Array<{ key: InstitutionKey; label: string; owners: [string, string]; wallet: (m: Manifest) => Address }> = [
  { key: "agent", label: "Agent", owners: ["agentGov1", "agentGov2"], wallet: (m) => m.governance!.agentGovernance },
  { key: "issuer", label: "Issuer", owners: ["issuerGov1", "issuerGov2"], wallet: (m) => m.governance!.issuerGovernance },
  { key: "cosigner", label: "Co-signing institution", owners: ["cosigner1", "cosigner2"], wallet: (m) => m.governance!.cosigner },
];

const now = () => new Date().toISOString();

function context() {
  const m = loadManifest();
  if (!m.governance) throw new Error("This deployment has no governance controller.");
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, g: m.governance, s: signers(chain, rpc) };
}
type Ctx = ReturnType<typeof context>;

const governedNote = (m: Manifest) => (m.instruments?.note ?? m.assets.note!.address) as Address;

/** A controller refusal, in words. */
function refusal(e: unknown): string {
  const data = (e as any)?.cause?.data ?? (e as any)?.data ?? (e as any)?.cause?.cause?.data;
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    try {
      const d = decodeErrorResult({ abi: [...CONTROLLER, ...TOKEN], data: data as Hex });
      const a = d.args as readonly unknown[] | undefined;
      switch (d.errorName) {
        case "ThresholdsNotMet": return `Thresholds not met: ${a?.[0]} institutions and ${a?.[1]} signatures approve; the controller needs at least two institutions and four signatures (S-22).`;
        case "NotReady": return Number(a?.[0]) === 0 ? "Not queued: the thresholds are not met yet (S-22)." : `Not ready: executable from ${new Date(Number(a?.[0]) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC, after the Tier 2 delay.`;
        case "Expired": return `Expired at ${new Date(Number(a?.[1]) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC: it was not executed within its window, and must be proposed afresh (S-24).`;
        case "AlreadyApproved": return "That institution has already approved it.";
        case "NotCancellable": return "Only the institution that proposed it can cancel it.";
        case "NotOpen": return "It is no longer open: executed or cancelled.";
        case "NoReason": return "A written reason is required.";
        case "NotAgentGovernance": return "Only the Agent's governance wallet acts at Tier 1.";
        case "AgentNotAuthorized": return `Refused by the note: ${a?.[0]} is an agent, but ${a?.[1]} for it. Only the governance controller may force a transfer (S-26).`;
        case "CallerDoesNotHaveAgentRole": return "Refused by the note: the caller is not one of its agents.";
        case "TransfersClosed": return "Refused: transfers are stopped from a record time until its determination, so the holder of record stays the account paid.";
        default: return `${d.errorName}${a?.length ? `(${a.map(String).join(", ")})` : ""}`;
      }
    } catch {
      // not one of ours
    }
  }
  return (e as Error)?.message?.split("\n")[0] ?? String(e);
}

/** Has an institution's wallet call the controller: simulated from the wallet first, then sent. */
async function asInstitution(c: Ctx, key: InstitutionKey, data: Hex): Promise<Hex> {
  const inst = INSTITUTIONS.find((i) => i.key === key)!;
  const wallet = inst.wallet(c.m);
  await c.s.publicClient.call({ account: wallet, to: c.g.controller, data }).catch((e) => {
    throw new Error(`${inst.label}: ${refusal(e)}`);
  });
  return execThroughWallet(c.s, wallet, inst.owners, "agent", c.g.controller, data);
}

// ---------------------------------------------------------------------------------------------
// What the console shows
// ---------------------------------------------------------------------------------------------

export type ProposalView = {
  id: number;
  kind: Kind;
  label: string;
  args: string;
  reason: string;
  proposer: string;
  approvals: Array<{ key: InstitutionKey; label: string; approved: boolean }>;
  institutions: number;
  signatures: number;
  readyAt: number;
  expiresAt: number | null;
  state: "awaiting approvals" | "queued" | "executable" | "executed" | "cancelled" | "expired";
};
export type GovernanceView = {
  chainNow: number;
  controller: Address;
  minInstitutions: number;
  minSignatures: number;
  tier2Delay: number;
  recoveryDelay: number;
  executionWindow: number | null;
  targetTier2Delay: number | null;
  targetExecutionWindow: number | null;
  institutions: Array<{ key: InstitutionKey; label: string; wallet: Address }>;
  proposals: ProposalView[];
  tier1: Array<{ action: string; reason: string; tx: string; block: number }>;
  note: { address: Address; name: string; symbol: string; total: string; inventory: string };
  /** The claim issuers the note trusts. */
  trustedIssuers: Address[];
  /** Whether the deployment has the optional conversion pool. */
  pool: boolean;
};

function describe(kind: Kind, args: Hex, m: Manifest): string {
  try {
    switch (kind) {
      case "AmendNotional": {
        const [increase, units] = decodeAbiParameters([{ type: "bool" }, { type: "uint256" }], args);
        return `${increase ? "Increase" : "Reduce"} by ${units} units`;
      }
      case "SetTrustedIssuer": {
        const [issuer, topics] = decodeAbiParameters([{ type: "address" }, { type: "uint256[]" }], args);
        return topics.length ? `Trust ${nameOf(m, issuer)} for the note` : `Cease to trust ${nameOf(m, issuer)}`;
      }
      case "SetLiquidityProvider": {
        const [a, approved] = decodeAbiParameters([{ type: "address" }, { type: "bool" }], args);
        return `${approved ? "Approve" : "Remove"} ${nameOf(m, a)}`;
      }
      default:
        return args.length > 66 ? `${args.slice(0, 66)}…` : args;
    }
  } catch {
    return args;
  }
}

/** A party's name from the manifest, or its address. */
export function nameOf(m: Manifest, a: string): string {
  const issuers = m.identity ? { "the bank's claim issuer": m.identity.bankIssuer, "the onboarding agent's claim issuer": m.identity.onboardingIssuer } : {};
  const parties = { ...(m.parties ?? {}), ...Object.fromEntries(Object.entries(m.custody?.accounts ?? {})), ...issuers } as Record<string, string>;
  const hit = Object.entries(parties).find(([, v]) => String(v).toLowerCase() === a.toLowerCase());
  return hit ? hit[0] : a;
}

export async function governanceView(): Promise<GovernanceView> {
  const c = context();
  const pc = c.s.publicClient;
  const read = <T>(functionName: any, args: readonly unknown[] = []) => pc.readContract({ address: c.g.controller, abi: CONTROLLER, functionName, args } as any) as Promise<T>;
  const note = governedNote(c.m);
  const [minI, minS, delay, recovery, window, count, block, total, inventory, trustedIssuers, noteName, noteSymbol] = await Promise.all([
    read<bigint>("MIN_INSTITUTIONS"),
    read<bigint>("MIN_SIGNATURES"),
    read<number>("TIER2_DELAY"),
    read<number>("RECOVERY_DELAY"),
    read<number>("EXECUTION_WINDOW").catch(() => null), // a controller from before ADR 0082 has none
    read<bigint>("proposalCount"),
    pc.getBlock(),
    pc.readContract({ address: note, abi: TOKEN, functionName: "totalSupply" }),
    pc.readContract({ address: note, abi: TOKEN, functionName: "balanceOf", args: [c.m.parties.issuer as Address] }),
    read<Address>("TRUSTED_ISSUERS").then((tir) => pc.readContract({ address: tir, abi: ISSUERS, functionName: "getTrustedIssuers" })).catch(() => [] as readonly Address[]),
    pc.readContract({ address: note, abi: TOKEN, functionName: "name" }),
    pc.readContract({ address: note, abi: TOKEN, functionName: "symbol" }),
  ]);
  const chainNow = Number(block.timestamp);
  const institutions = INSTITUTIONS.map((i) => ({ key: i.key, label: i.label, wallet: i.wallet(c.m) }));
  const proposals: ProposalView[] = [];
  for (let id = Number(count); id >= 1; id--) {
    const [p, [ic, sig], approved] = await Promise.all([
      read<{ kind: number; proposer: Address; readyAt: number; executed: boolean; cancelled: boolean; args: Hex; reason: string }>("proposal", [BigInt(id)]),
      read<readonly [bigint, bigint]>("approvals", [BigInt(id)]),
      Promise.all(institutions.map((i) => read<boolean>("approvedBy", [BigInt(id), i.wallet]))),
    ]);
    const kind = KINDS[p.kind];
    const readyAt = Number(p.readyAt);
    const expiresAt = window !== null && readyAt ? readyAt + Number(window) : null;
    const state: ProposalView["state"] = p.executed ? "executed" : p.cancelled ? "cancelled" : !readyAt ? "awaiting approvals" : expiresAt !== null && chainNow > expiresAt ? "expired" : chainNow >= readyAt ? "executable" : "queued";
    proposals.push({
      id,
      kind,
      label: KIND_LABEL[kind],
      args: describe(kind, p.args, c.m),
      reason: p.reason,
      proposer: institutions.find((i) => i.wallet.toLowerCase() === p.proposer.toLowerCase())?.label ?? p.proposer,
      approvals: institutions.map((i, k) => ({ key: i.key, label: i.label, approved: approved[k] })),
      institutions: Number(ic),
      signatures: Number(sig),
      readyAt,
      expiresAt,
      state,
    });
  }
  const { client, from } = await ledgerFrom().catch(() => ({ client: pc, from: 0n }));
  const logs = await client.getLogs({ address: c.g.controller, event: TIER1, fromBlock: from, toBlock: "latest" }).catch(() => []);
  return {
    chainNow,
    controller: c.g.controller,
    minInstitutions: Number(minI),
    minSignatures: Number(minS),
    tier2Delay: Number(delay),
    recoveryDelay: Number(recovery),
    executionWindow: window === null ? null : Number(window),
    targetTier2Delay: c.g.targetTier2Delay ?? null,
    targetExecutionWindow: c.g.targetExecutionWindow ?? null,
    institutions,
    proposals,
    tier1: logs.map((l) => ({ action: l.args.action!, reason: l.args.reason!, tx: l.transactionHash, block: Number(l.blockNumber) })).reverse(),
    note: { address: note, name: noteName, symbol: noteSymbol, total: String(total), inventory: String(inventory) },
    trustedIssuers: [...trustedIssuers],
    pool: Boolean(c.m.venue),
  };
}

/**
 * The accounts the governed note can act on, with their units of it, for the console's choices: the
 * deployment's own parties by their capacity, and every account onboarded on the site by the bank's
 * client it was confirmed against (ADR 0110), its route beside it.
 */
export async function parties(): Promise<Array<{ name: string; address: Address; units: string }>> {
  const c = context();
  const note = governedNote(c.m);
  const named = new Map<string, { name: string; address: Address }>();
  const put = (a: string, name: string) => /^0x[0-9a-fA-F]{40}$/.test(a) && named.set(a.toLowerCase(), { name, address: a as Address });
  for (const [key, a] of Object.entries(c.m.parties ?? {})) put(String(a), partyLabel(key));
  for (const [ref, a] of Object.entries(c.m.custody?.accounts ?? {})) put(String(a), `${ref}, bank custody`);
  const nameOf = await accountNamer();
  for (const a of await getStore().listAdmissions(1000)) {
    const wallet = (a.data as { wallet?: string }).wallet;
    if (a.status === "onboarded" && wallet) put(wallet, `${nameOf(a)}, ${routeLabel(a.route)}`);
  }
  const rows = [...named.values()];
  const units = await Promise.all(rows.map((r) => c.s.publicClient.readContract({ address: note, abi: TOKEN, functionName: "balanceOf", args: [r.address] }).catch(() => 0n)));
  return rows.map((r, i) => ({ ...r, units: String(units[i]) })).sort((x, y) => x.name.localeCompare(y.name));
}

// ---------------------------------------------------------------------------------------------
// Acts
// ---------------------------------------------------------------------------------------------

function staffOnly(staff: Registrant) {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
}
function needReason(reason: string): string {
  const r = reason.trim();
  if (!r) throw new Error("A written reason is required: it is recorded on-chain in full.");
  return r;
}
const audit = (staff: Registrant, action: string, subject: string) => getStore().audit({ at: now(), actor: staff.email, action, subject });

/** Tier 1 (S-25): the Agent's governance wallet corrects the register, at once, with its reason. */
export async function correctRegister(staff: Registrant, input: { from: Address; to: Address; units: number; reason: string }): Promise<Hex> {
  staffOnly(staff);
  const reason = needReason(input.reason);
  if (!Number.isInteger(input.units) || input.units < 1) throw new Error("Correct at least one unit.");
  if (input.from.toLowerCase() === input.to.toLowerCase()) throw new Error("Choose two different accounts.");
  const c = context();
  const held = await c.s.publicClient.readContract({ address: governedNote(c.m), abi: TOKEN, functionName: "balanceOf", args: [input.from] });
  if (held < BigInt(input.units)) throw new Error(`${nameOf(c.m, input.from)} holds ${held} units, not ${input.units}.`);
  const tx = await asInstitution(c, "agent", encodeFunctionData({ abi: CONTROLLER, functionName: "correctRegister", args: [input.from, input.to, BigInt(input.units), reason] }));
  await audit(staff, `Tier 1: corrected the register, ${input.units} units from ${nameOf(c.m, input.from)} to ${nameOf(c.m, input.to)}: ${reason}`, tx);
  return tx;
}

/**
 * Tier 1: the Agent's governance wallet freezes or unfreezes an account on the note at once,
 * whichever institution vouched for it (ADR 0088), or withdraws or restores its pool access (ADR 0090).
 */
export async function withdraw(staff: Registrant, input: { what: "freeze" | "unfreeze" | "pool" | "restore-pool"; account: Address; reason: string }): Promise<Hex> {
  staffOnly(staff);
  const reason = needReason(input.reason);
  const c = context();
  const data = input.what === "pool"
    ? encodeFunctionData({ abi: CONTROLLER, functionName: "withdrawPoolAccess", args: [input.account, reason] })
    : input.what === "restore-pool"
      ? encodeFunctionData({ abi: CONTROLLER, functionName: "restorePoolAccess", args: [input.account, reason] })
      : encodeFunctionData({ abi: CONTROLLER, functionName: "freezeAccount", args: [input.account, input.what === "freeze", reason] });
  const tx = await asInstitution(c, "agent", data);
  const said = { pool: "withdrew pool access of", "restore-pool": "restored pool access of", freeze: "froze", unfreeze: "unfroze" }[input.what];
  await audit(staff, `Tier 1: ${said} ${nameOf(c.m, input.account)}: ${reason}`, tx);
  return tx;
}

/**
 * Tier 1 (S-25): the Agent's governance wallet recovers a holder's units from a lost wallet to its
 * new one; the identity moves with them. Refused while transfers are stopped at a Record Time.
 */
export async function recoverWallet(staff: Registrant, input: { lost: Address; replacement: Address; reason: string }): Promise<Hex> {
  staffOnly(staff);
  const reason = needReason(input.reason);
  if (input.lost.toLowerCase() === input.replacement.toLowerCase()) throw new Error("Choose a new wallet.");
  const c = context();
  const note = governedNote(c.m);
  const registry = await c.s.publicClient.readContract({ address: note, abi: TOKEN, functionName: "identityRegistry" });
  const identity = await c.s.publicClient.readContract({ address: registry, abi: REGISTRY, functionName: "identity", args: [input.lost] });
  if (/^0x0{40}$/i.test(identity)) throw new Error(`${nameOf(c.m, input.lost)} has no identity in the note's registry.`);
  const tx = await asInstitution(c, "agent", encodeFunctionData({ abi: CONTROLLER, functionName: "recoverWallet", args: [input.lost, input.replacement, identity, reason] }));
  await audit(staff, `Tier 1: recovered the units of ${nameOf(c.m, input.lost)} to ${input.replacement}: ${reason}`, tx);
  return tx;
}

/** Tier 2: an institution proposes one of the acts offered from the site (ADR 0082). */
export async function propose(
  staff: Registrant,
  input: { by: InstitutionKey; kind: Kind; reason: string; increase?: boolean; units?: number; account?: Address; approved?: boolean },
): Promise<{ tx: Hex; id: number }> {
  staffOnly(staff);
  const reason = needReason(input.reason);
  if (!OFFERED.includes(input.kind)) throw new Error(`${KIND_LABEL[input.kind]} is not offered from the site: it is proposed and executed by the institutions' own wallets.`);
  const c = context();
  let data: Hex;
  if (input.kind === "AmendNotional") {
    if (!Number.isInteger(input.units) || (input.units ?? 0) < 1) throw new Error("Amend by at least one unit.");
    data = encodeFunctionData({ abi: CONTROLLER, functionName: "proposeAmendNotional", args: [Boolean(input.increase), BigInt(input.units!), reason] });
  } else if (input.kind === "SetTrustedIssuer") {
    if (!input.account) throw new Error("Give the claim issuer's address.");
    data = encodeFunctionData({ abi: CONTROLLER, functionName: "proposeSetTrustedIssuer", args: [input.account, input.approved ? [NOTE_TOPIC] : [], reason] });
  } else {
    if (!c.m.venue) throw new Error("This deployment has no conversion pool.");
    if (!input.account) throw new Error("Choose the account.");
    data = encodeFunctionData({ abi: CONTROLLER, functionName: "proposeSetLiquidityProvider", args: [input.account, Boolean(input.approved), reason] });
  }
  const before = Number(await c.s.publicClient.readContract({ address: c.g.controller, abi: CONTROLLER, functionName: "proposalCount" }));
  const tx = await asInstitution(c, input.by, data);
  const id = before + 1;
  await until(() => c.s.publicClient.readContract({ address: c.g.controller, abi: CONTROLLER, functionName: "proposalCount" }), (n) => Number(n) >= id);
  const label = INSTITUTIONS.find((i) => i.key === input.by)!.label;
  await audit(staff, `Tier 2 proposal ${id} by the ${label}: ${KIND_LABEL[input.kind]}: ${reason}`, tx);
  return { tx, id };
}

/** Tier 2: an institution approves a proposal; it is queued once the thresholds are met. */
export async function approve(staff: Registrant, id: number, by: InstitutionKey): Promise<Hex> {
  staffOnly(staff);
  const c = context();
  const tx = await asInstitution(c, by, encodeFunctionData({ abi: CONTROLLER, functionName: "approve", args: [BigInt(id)] }));
  const wallet = INSTITUTIONS.find((i) => i.key === by)!.wallet(c.m);
  await until(() => c.s.publicClient.readContract({ address: c.g.controller, abi: CONTROLLER, functionName: "approvedBy", args: [BigInt(id), wallet] }), Boolean);
  await audit(staff, `Tier 2 proposal ${id} approved by the ${INSTITUTIONS.find((i) => i.key === by)!.label}`, tx);
  return tx;
}

/** Tier 2: executes a queued proposal after its delay and within its window. Anyone may; the Agent's key sends. */
export async function execute(staff: Registrant, id: number): Promise<Hex> {
  staffOnly(staff);
  const c = context();
  const data = encodeFunctionData({ abi: CONTROLLER, functionName: "execute", args: [BigInt(id)] });
  await c.s.publicClient.call({ account: c.s.address("agent"), to: c.g.controller, data }).catch((e) => {
    throw new Error(refusal(e));
  });
  const tx = await c.s.send("agent", { address: c.g.controller, abi: CONTROLLER, functionName: "execute", args: [BigInt(id)] });
  await until(() => c.s.publicClient.readContract({ address: c.g.controller, abi: CONTROLLER, functionName: "proposal", args: [BigInt(id)] }), (p) => p.executed);
  await audit(staff, `Tier 2 proposal ${id} executed`, tx);
  return tx;
}

/** Tier 2: the proposing institution cancels its proposal. */
export async function cancel(staff: Registrant, id: number): Promise<Hex> {
  staffOnly(staff);
  const c = context();
  const p = await c.s.publicClient.readContract({ address: c.g.controller, abi: CONTROLLER, functionName: "proposal", args: [BigInt(id)] });
  const by = INSTITUTIONS.find((i) => i.wallet(c.m).toLowerCase() === p.proposer.toLowerCase());
  if (!by) throw new Error("Its proposer is not an institution the site signs for.");
  const tx = await asInstitution(c, by.key, encodeFunctionData({ abi: CONTROLLER, functionName: "cancel", args: [BigInt(id)] }));
  await audit(staff, `Tier 2 proposal ${id} cancelled by the ${by.label}`, tx);
  return tx;
}

/**
 * S-26: the Agent attempting a forced transfer outside the control framework, simulated as its
 * servicing wallet. Nothing is sent; the note's refusal is returned, with who does hold the right.
 */
export async function attemptAgentForcedTransfer(staff: Registrant): Promise<string> {
  staffOnly(staff);
  const c = context();
  const note = governedNote(c.m);
  const from = c.m.parties.investorA as Address;
  const to = c.m.parties.investorB as Address;
  const data = encodeFunctionData({ abi: TOKEN, functionName: "forcedTransfer", args: [from, to, 1n] });
  const [servicing, controller] = await Promise.all(
    [c.g.servicingWallet, c.g.controller].map(async (who) => {
      const agent = await c.s.publicClient.readContract({ address: note, abi: TOKEN, functionName: "isAgent", args: [who] });
      if (!agent) return false;
      const r = await c.s.publicClient.readContract({ address: note, abi: TOKEN, functionName: "getAgentRestrictions", args: [who] });
      return !r.disableForceTransfer;
    }),
  );
  try {
    await c.s.publicClient.call({ account: c.g.servicingWallet, to: note, data });
  } catch (e) {
    await audit(staff, "S-26: attempted a forced transfer as the Agent's servicing wallet, outside the control framework: refused", note);
    return `${refusal(e)} The servicing wallet may force a transfer: ${servicing ? "yes" : "no"}; the controller: ${controller ? "yes" : "no"}.`;
  }
  throw new Error("The note allowed the Agent's servicing wallet to force a transfer: the control framework is not in force.");
}
