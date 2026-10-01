import "server-only";
import { decodeAbiParameters, decodeErrorResult, defineChain, encodeFunctionData, keccak256, parseAbi, parseAbiItem, toBytes, type Address, type Hex } from "viem";
import { loadManifest, type Manifest } from "./chain/manifest.ts";
import { signers } from "./chain/signer.ts";
import { execThroughWallet } from "./chain/safe.ts";
import { until } from "./chain/until.ts";
import { ledgerFrom } from "./ledger.ts";
import { getStore, type Registrant } from "./store.ts";
import { isOperator } from "./operators.ts";

/**
 * The governance controller, from the site (ADR 0082). It governs the deployment's own note, the
 * deposit, the registry, the Paying Agent and the venue; notes issued from the site are the
 * Issuer's to administer (ADR 0072).
 *
 * - **Tier 1** is the Agent's governance wallet alone, at once, with a written reason: correcting
 *   the register by forced transfer (S-25), and withdrawing a grant or pool access.
 * - **Tier 2** is proposed and approved by the institutions' governance wallets: queued once at
 *   least two institutions approve with four signatures between their wallets (S-22), executable
 *   after the delay and, on a controller from ADR 0082, only within the execution window (S-24).
 * - **Each institution acts as itself.** Every act is its own 2-of-3 wallet's transaction, signed
 *   by two of its owners' keys the site holds and sent by the Agent's key. Each is first simulated
 *   from that wallet, so a refusal is the controller's own reason.
 * - **Acts offered** are those that cannot break the deployment. Upgrades, gate and registrar
 *   changes, and replacing the servicing wallet or an institution are listed, not offered.
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
  "function withdrawGrant(address account, string reason)",
  "function withdrawPoolAccess(address account, string reason)",
  "function proposeAmendNotional(bool increase, uint256 units, string reason) returns (uint256)",
  "function proposeSetMaxValidity(uint40 maxValidity, string reason) returns (uint256)",
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
  "error NotGoverned(address token)",
  "error InvalidArgument()",
  "error NotServicingWallet(address caller)",
  "error NoVenue()",
  "error Expired(uint256 id, uint48 expiredAt)",
]);
const TOKEN = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function forcedTransfer(address from, address to, uint256 value, bytes data) returns (bool)",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
]);
const REGISTRY = parseAbi(["function maxValidity() view returns (uint40)"]);
const TIER1 = parseAbiItem("event Tier1(string action, string reason)");
const FORCED_TRANSFER_ROLE = keccak256(toBytes("FORCED_TRANSFER_ROLE"));

/** The controller's kinds of Tier 2 proposal, in its enum's order. */
export const KINDS = [
  "Upgrade",
  "ReplaceGate",
  "AmendNotional",
  "ReverseDistribution",
  "RestateDistribution",
  "SetRegistrar",
  "SetMaxValidity",
  "ReplaceServicingWallet",
  "ReplaceInstitution",
  "SetCredentialGate",
  "SetLiquidityProvider",
  "SetVenueWrapper",
  "SetVenueHook",
  "SetPoolAttester",
] as const;
export type Kind = (typeof KINDS)[number];
/** Offered from the site; the rest could break the deployment if misused (ADR 0082). */
export const OFFERED: Kind[] = ["AmendNotional", "SetMaxValidity", "SetLiquidityProvider"];
export const KIND_LABEL: Record<Kind, string> = {
  Upgrade: "Upgrade an instrument",
  ReplaceGate: "Replace an instrument's gate",
  AmendNotional: "Amend the notional in the Issuer's inventory",
  ReverseDistribution: "Reverse a distribution",
  RestateDistribution: "Restate a distribution",
  SetRegistrar: "Appoint or remove a registrar",
  SetMaxValidity: "Set the longest a grant may run",
  ReplaceServicingWallet: "Replace the Agent's servicing wallet",
  ReplaceInstitution: "Replace an institution's wallet (recovery)",
  SetCredentialGate: "Point the pool at a new credential gate",
  SetLiquidityProvider: "Approve or remove a liquidity provider",
  SetVenueWrapper: "Allow or refuse a router or position manager",
  SetVenueHook: "Allow or refuse a hook",
  SetPoolAttester: "Appoint or remove a pool attester",
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
        case "AccessControlUnauthorizedAccount": return `Refused by the note: ${a?.[0]} lacks the role this needs. Only the governance controller may force a transfer (S-26).`;
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
  note: { address: Address; total: string; inventory: string };
  maxValidity: number;
};

function describe(kind: Kind, args: Hex, m: Manifest): string {
  try {
    switch (kind) {
      case "AmendNotional": {
        const [increase, units] = decodeAbiParameters([{ type: "bool" }, { type: "uint256" }], args);
        return `${increase ? "Increase" : "Reduce"} by ${units} units`;
      }
      case "SetMaxValidity": {
        const [v] = decodeAbiParameters([{ type: "uint40" }], args);
        return `${Math.round(Number(v) / 86_400)} days`;
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
  const parties = { ...(m.parties ?? {}), ...Object.fromEntries(Object.entries(m.custody?.accounts ?? {})) } as Record<string, string>;
  const hit = Object.entries(parties).find(([, v]) => String(v).toLowerCase() === a.toLowerCase());
  return hit ? hit[0] : a;
}

export async function governanceView(): Promise<GovernanceView> {
  const c = context();
  const pc = c.s.publicClient;
  const read = <T>(functionName: any, args: readonly unknown[] = []) => pc.readContract({ address: c.g.controller, abi: CONTROLLER, functionName, args } as any) as Promise<T>;
  const note = governedNote(c.m);
  const [minI, minS, delay, recovery, window, count, block, total, inventory, maxValidity] = await Promise.all([
    read<bigint>("MIN_INSTITUTIONS"),
    read<bigint>("MIN_SIGNATURES"),
    read<number>("TIER2_DELAY"),
    read<number>("RECOVERY_DELAY"),
    read<number>("EXECUTION_WINDOW").catch(() => null), // a controller from before ADR 0082 has none
    read<bigint>("proposalCount"),
    pc.getBlock(),
    pc.readContract({ address: note, abi: TOKEN, functionName: "totalSupply" }),
    pc.readContract({ address: note, abi: TOKEN, functionName: "balanceOf", args: [c.m.parties.issuer as Address] }),
    pc.readContract({ address: c.m.instruments!.registry, abi: REGISTRY, functionName: "maxValidity" }).catch(() => 0),
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
    note: { address: note, total: String(total), inventory: String(inventory) },
    maxValidity: Number(maxValidity),
  };
}

/** Accounts known to the deployment, with their units of the governed note, for the console's choices. */
export async function parties(): Promise<Array<{ name: string; address: Address; units: string }>> {
  const c = context();
  const note = governedNote(c.m);
  const named = { ...(c.m.parties ?? {}), ...(c.m.custody?.accounts ?? {}) } as Record<string, string>;
  const rows = Object.entries(named).filter(([, a]) => /^0x[0-9a-fA-F]{40}$/.test(String(a)));
  const units = await Promise.all(rows.map(([, a]) => c.s.publicClient.readContract({ address: note, abi: TOKEN, functionName: "balanceOf", args: [a as Address] }).catch(() => 0n)));
  return rows.map(([name, a], i) => ({ name, address: a as Address, units: String(units[i]) }));
}

// ---------------------------------------------------------------------------------------------
// Acts
// ---------------------------------------------------------------------------------------------

function staffOnly(staff: Registrant) {
  if (!isOperator(staff.email)) throw new Error("Not permitted.");
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

/** Tier 1: the Agent's governance wallet withdraws a grant, or an account's pool access, at once. */
export async function withdraw(staff: Registrant, input: { what: "grant" | "pool"; account: Address; reason: string }): Promise<Hex> {
  staffOnly(staff);
  const reason = needReason(input.reason);
  const c = context();
  const data = input.what === "grant"
    ? encodeFunctionData({ abi: CONTROLLER, functionName: "withdrawGrant", args: [input.account, reason] })
    : encodeFunctionData({ abi: CONTROLLER, functionName: "withdrawPoolAccess", args: [input.account, reason] });
  const tx = await asInstitution(c, "agent", data);
  await audit(staff, `Tier 1: withdrew ${input.what === "grant" ? "the registry grant" : "pool access"} of ${nameOf(c.m, input.account)}: ${reason}`, tx);
  return tx;
}

/** Tier 2: an institution proposes one of the acts offered from the site (ADR 0082). */
export async function propose(
  staff: Registrant,
  input: { by: InstitutionKey; kind: Kind; reason: string; increase?: boolean; units?: number; days?: number; account?: Address; approved?: boolean },
): Promise<{ tx: Hex; id: number }> {
  staffOnly(staff);
  const reason = needReason(input.reason);
  if (!OFFERED.includes(input.kind)) throw new Error(`${KIND_LABEL[input.kind]} is not offered from the site (ADR 0082).`);
  const c = context();
  let data: Hex;
  if (input.kind === "AmendNotional") {
    if (!Number.isInteger(input.units) || (input.units ?? 0) < 1) throw new Error("Amend by at least one unit.");
    data = encodeFunctionData({ abi: CONTROLLER, functionName: "proposeAmendNotional", args: [Boolean(input.increase), BigInt(input.units!), reason] });
  } else if (input.kind === "SetMaxValidity") {
    if (!Number.isInteger(input.days) || (input.days ?? 0) < 1) throw new Error("Give the longest validity in whole days, at least one.");
    data = encodeFunctionData({ abi: CONTROLLER, functionName: "proposeSetMaxValidity", args: [input.days! * 86_400, reason] });
  } else {
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
  const data = encodeFunctionData({ abi: TOKEN, functionName: "forcedTransfer", args: [from, to, 1n, "0x"] });
  const [servicingHas, controllerHas] = await Promise.all([
    c.s.publicClient.readContract({ address: note, abi: TOKEN, functionName: "hasRole", args: [FORCED_TRANSFER_ROLE, c.g.servicingWallet] }),
    c.s.publicClient.readContract({ address: note, abi: TOKEN, functionName: "hasRole", args: [FORCED_TRANSFER_ROLE, c.g.controller] }),
  ]);
  try {
    await c.s.publicClient.call({ account: c.g.servicingWallet, to: note, data });
  } catch (e) {
    await audit(staff, "S-26: attempted a forced transfer as the Agent's servicing wallet, outside the control framework: refused", note);
    return `${refusal(e)} The servicing wallet holds the forced-transfer right: ${servicingHas ? "yes" : "no"}; the controller: ${controllerHas ? "yes" : "no"}.`;
  }
  throw new Error("The note allowed the Agent's servicing wallet to force a transfer: the control framework is not in force.");
}
