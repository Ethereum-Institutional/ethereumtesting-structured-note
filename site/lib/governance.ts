import "server-only";
import { decodeAbiParameters, decodeErrorResult, defineChain, encodeFunctionData, keccak256, parseAbi, parseAbiItem, toBytes, zeroAddress, type Address, type Hex } from "viem";
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
 * The governance controller, from the site. One controller governs every note the programme
 * issues: it holds each note's agent powers and owns its registries, its Paying Agent and its
 * determinations' corrections, and, where there is one, the venue.
 *
 * - **Tier 1** is the Agent's governance wallet alone, at once, with a written reason: correcting
 *   one note's register by forced transfer; recovering a lost wallet's units on every note it
 *   holds; freezing an account on one note or all of them; designating an account under the
 *   programme's sanctions; cancelling units from the Issuer's inventory; and withdrawing or
 *   restoring pool access.
 * - **Tier 2** is proposed and approved by the institutions' governance wallets: queued once at
 *   least two institutions approve with four signatures between their wallets, executable after
 *   the delay and only within the execution window.
 * - **Each institution acts as itself.** Every act is its own 2-of-3 wallet's transaction, signed
 *   by two of its owners' keys the site holds and sent by the Agent's key. Each is first simulated
 *   from that wallet, so a refusal is the controller's own reason, put in plain words.
 * - **Acts offered** are those that cannot break the deployment the site runs: amending a note's
 *   notional, trusting a claim issuer for a note, correcting a determination, retiring a redeemed
 *   note, and approving a liquidity provider. Replacing a role or an institution, changing the
 *   deposit's roles and releasing the factory are listed, not offered: the site signs with the
 *   current holders' keys alone.
 */

const OUTCOME = "(bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex)";
const CORRECTION = `(address token, uint256 dateIndex, uint256[] levels, ${OUTCOME} outcome, bytes signature, address[] holders)`;

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
  "function institutions() view returns (address[])",
  "function notes() view returns (address[])",
  "function governed(address token) view returns ((address identityRegistry, address trustedIssuers, address determinations, address recordDates, address payingAgent, address inventory))",
  "function servicingWallet() view returns (address)",
  "function calculationAgent() view returns (address)",
  "function funder() view returns (address)",
  "function correctRegister(address token, address from, address to, uint256 units, string reason)",
  "function freezeAccount(address[] tokens, address account, bool frozen, string reason)",
  "function recoverWallet(address[] tokens, address lostWallet, address newWallet, address identity, string reason)",
  "function designate(address account, bool on, string reason)",
  "function cancelInventory(address token, uint256 units, string reason)",
  "function withdrawPoolAccess(address account, string reason)",
  "function restorePoolAccess(address account, string reason)",
  "function proposeAmendNotional(address token, bool increase, uint256 units, string reason) returns (uint256)",
  "function proposeSetTrustedIssuer(address token, address issuer, uint256[] topics, string reason) returns (uint256)",
  `function proposeCorrectDetermination(${CORRECTION} c, string reason) returns (uint256)`,
  "function proposeRetireNote(address token, string reason) returns (uint256)",
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
  "error NotGoverned(address token)",
  "error InventoryUnavailable(uint256 units, uint256 available)",
  "error Expired(uint256 id, uint48 expiredAt)",
  // Reached through the controller: the pool gate's, the correction's, the factory's, the Determination Agent's and the Paying Agent's.
  "error AlreadyWithdrawn(address account)",
  "error NotWithdrawn(address account)",
  "error RedemptionUnderway(address token, uint256 dateIndex)",
  "error CouponNotClosed(address token, uint256 dateIndex)",
  "error NotRedeemed(address token)",
  "error NotLatestDate(uint256 dateIndex, uint256 latest)",
  `error OutcomeDisagrees(${OUTCOME} computed)`,
  "error BadSignature()",
  "error AlreadyReversed(address holder)",
  "error NotSettled(address holder)",
]);
const TOKEN = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function paused() view returns (bool)",
  "function isAgent(address agent) view returns (bool)",
  "function identityRegistry() view returns (address)",
  "function getAgentRestrictions(address agent) view returns ((bool disableMint, bool disableBurn, bool disablePartialFreeze, bool disableAddressFreeze, bool disableRecovery, bool disableForceTransfer, bool disablePause))",
  "function forcedTransfer(address from, address to, uint256 amount) returns (bool)",
  "error AgentNotAuthorized(address agent, string reason)",
  "error CallerDoesNotHaveAgentRole()",
  "error UnverifiedIdentity()",
  "error ComplianceNotFollowed()",
]);
const DETERMINATIONS = parseAbi([
  "function nextDate() view returns (uint256)",
  "function observation(uint256 dateIndex) view returns ((uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps))",
  `function outcomeOf(uint256 dateIndex) view returns (${OUTCOME})`,
  `function computeCorrection(uint256 dateIndex, uint256[] levels) view returns (${OUTCOME})`,
  `function digest(uint256 dateIndex, uint256[] levels, ${OUTCOME} o) view returns (bytes32)`,
  "error InvalidLevels()",
  "error NotLatestDate(uint256 dateIndex, uint256 latest)",
]);
const PAYING = parseAbi([
  "function idOf(uint256 dateIndex, uint8 kind) pure returns (bytes32)",
  "function distributions(bytes32 id) view returns (uint48 recordTime, uint64 perCa, uint64 unitsEntitled, uint64 unitsPaid, bool open, bool closed, uint8 kind, bool reversed, uint64 unitsReversed, uint256 dateIndex)",
  "function FUNDER() view returns (address)",
]);
const PAID = parseAbiItem("event Paid(bytes32 indexed id, address indexed holder, uint256 units, uint256 amount)");
const HELD = parseAbiItem("event Held(bytes32 indexed id, address indexed holder, uint256 units, uint256 amount)");
const CASH = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);
const REGISTRY = parseAbi(["function identity(address wallet) view returns (address)"]);
const ISSUERS = parseAbi(["function getTrustedIssuers() view returns (address[])"]);
const TIER1 = parseAbiItem("event Tier1(address indexed token, string action, string reason)");
/** The note-eligible claim topic. */
const NOTE_TOPIC = BigInt(keccak256(toBytes("claim.note-eligible")));
const COUPON = 0;
const REDEMPTION = 1;

/** The controller's kinds of Tier 2 proposal, in its enum's order. */
export const KINDS = [
  "AmendNotional",
  "ReverseDistribution",
  "RestateDistribution",
  "CorrectDetermination",
  "SetTrustedIssuer",
  "ReplaceServicingWallet",
  "ReplaceCalculationAgent",
  "ReplaceFunder",
  "ReplaceInstitution",
  "SetDepositRole",
  "RetireNote",
  "ReleaseFactory",
  "SetCredentialGate",
  "SetLiquidityProvider",
  "SetVenueWrapper",
  "SetVenueHook",
  "SetPoolIssuer",
] as const;
export type Kind = (typeof KINDS)[number];
/** Offered from the site; the rest would leave the site without the keys it signs with. */
export const OFFERED: Kind[] = ["AmendNotional", "SetTrustedIssuer", "CorrectDetermination", "RetireNote", "SetLiquidityProvider"];
export const KIND_LABEL: Record<Kind, string> = {
  AmendNotional: "Amend the notional in the Issuer's inventory",
  ReverseDistribution: "Reverse a distribution",
  RestateDistribution: "Restate a distribution",
  CorrectDetermination: "Correct a determination",
  SetTrustedIssuer: "Trust a claim issuer for a note, or cease to",
  ReplaceServicingWallet: "Replace the servicing wallet, for every note",
  ReplaceCalculationAgent: "Replace the Calculation Agent, for every note",
  ReplaceFunder: "Replace the account that funds distributions, for every note",
  ReplaceInstitution: "Replace an institution's wallet (recovery)",
  SetDepositRole: "Grant or revoke a role on the deposit",
  RetireNote: "Retire a redeemed note",
  ReleaseFactory: "Hand the T-REX factory to a successor",
  SetCredentialGate: "Point the pool at a new gate",
  SetLiquidityProvider: "Approve or remove a liquidity provider",
  SetVenueWrapper: "Allow or refuse a router or position manager",
  SetVenueHook: "Allow or refuse a hook",
  SetPoolIssuer: "Trust a claim issuer to vouch for pool access, or cease to",
};
/** Kinds that act on one note: the note is the first thing their proposal names. */
const ON_A_NOTE: Kind[] = ["AmendNotional", "ReverseDistribution", "RestateDistribution", "SetTrustedIssuer", "RetireNote"];

export type InstitutionKey = "agent" | "issuer" | "cosigner";
const INSTITUTIONS: Array<{ key: InstitutionKey; label: string; owners: [string, string]; wallet: (m: Manifest) => Address }> = [
  { key: "agent", label: "Agent", owners: ["agentGov1", "agentGov2"], wallet: (m) => m.governance!.agentGovernance },
  { key: "issuer", label: "Issuer", owners: ["issuerGov1", "issuerGov2"], wallet: (m) => m.governance!.issuerGovernance },
  { key: "cosigner", label: "Co-signing institution", owners: ["cosigner1", "cosigner2"], wallet: (m) => m.governance!.cosigner },
];

const now = () => new Date().toISOString();
const at = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

function context() {
  const m = loadManifest();
  if (!m.governance) throw new Error("This deployment has no governance controller.");
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, g: m.governance, s: signers(chain, rpc) };
}
type Ctx = ReturnType<typeof context>;

/** A controller refusal, in words. */
function refusal(e: unknown): string {
  const data = (e as any)?.cause?.data ?? (e as any)?.data ?? (e as any)?.cause?.cause?.data;
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    try {
      const d = decodeErrorResult({ abi: [...CONTROLLER, ...TOKEN], data: data as Hex });
      const a = d.args as readonly unknown[] | undefined;
      switch (d.errorName) {
        case "ThresholdsNotMet": return `Not enough approvals yet: ${a?.[0]} institutions and ${a?.[1]} signatures; it needs at least two institutions and four signatures.`;
        case "NotReady": return Number(a?.[0]) === 0 ? "Not queued: not enough institutions have approved it yet." : `Not ready: it can be executed from ${at(Number(a?.[0]))}, once the waiting period has passed.`;
        case "Expired": return `It expired at ${at(Number(a?.[1]))}: it was not executed in time, and must be proposed again.`;
        case "AlreadyApproved": return "That institution has already approved it.";
        case "NotCancellable": return "Only the institution that proposed it can cancel it.";
        case "NotOpen": return "It is no longer open: it was executed or cancelled.";
        case "NoReason": return "A written reason is required.";
        case "NotAgentGovernance": return "Only the Agent's governance wallet acts at Tier 1.";
        case "NotGoverned": return "The controller does not govern that note.";
        case "InventoryUnavailable": return `The Issuer's inventory has ${a?.[1]} units free to cancel, not ${a?.[0]}.`;
        case "AgentNotAuthorized": return `The note refused: ${a?.[0]} is one of its agents, but is not allowed to ${a?.[1]}. Only the governance controller may force a transfer.`;
        case "CallerDoesNotHaveAgentRole": return "The note refused: the caller is not one of its agents.";
        case "TransfersClosed": return "Refused: transfers stop at a record time until that date is determined, so that the holder of record stays the one paid.";
        case "RedemptionUnderway": return "This date's redemption has already started paying, so its determination can no longer be corrected.";
        case "CouponNotClosed": return "This date's coupon is still being paid. Finish paying it, then correct it: the payment is reversed and paid again at the corrected amount.";
        case "NotRedeemed": return "The note can be retired only once it has redeemed and no unit remains.";
        case "NotLatestDate": return `Only the latest date determined (date ${Number(a?.[1]) + 1}) can be corrected.`;
        case "OutcomeDisagrees": return "The corrected outcome no longer matches what the contract computes; propose the correction again.";
        case "BadSignature": return "The Calculation Agent's signature does not match the correction.";
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

export type GovernedNote = { address: Address; name: string; symbol: string };
export type ProposalView = {
  id: number;
  kind: Kind;
  label: string;
  /** The note the proposal acts on, where it acts on one. */
  note: string | null;
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
  /** The programme's roles, shared by every note. */
  roles: { servicingWallet: Address; calculationAgent: Address; funder: Address };
  proposals: ProposalView[];
  tier1: Array<{ note: string; action: string; reason: string; tx: string; block: number }>;
  /** Every note the controller governs, and the one chosen. */
  notes: GovernedNote[];
  note: GovernedNote & { total: string; inventory: string; paused: boolean; nextDate: number; determinations: Address };
  /** The claim issuers the chosen note trusts. */
  trustedIssuers: Address[];
  /** Whether the deployment has the optional conversion pool. */
  pool: boolean;
};

/** Every note the controller governs, with its name and symbol, in the order issued. */
export async function governedNotes(): Promise<GovernedNote[]> {
  const c = context();
  const pc = c.s.publicClient;
  const tokens = await pc.readContract({ address: c.g.controller, abi: CONTROLLER, functionName: "notes" });
  return Promise.all(
    tokens.map(async (address) => {
      const [name, symbol] = await Promise.all([
        pc.readContract({ address, abi: TOKEN, functionName: "name" }),
        pc.readContract({ address, abi: TOKEN, functionName: "symbol" }),
      ]);
      return { address, name, symbol };
    }),
  );
}

function describe(kind: Kind, args: Hex, m: Manifest, symbols: Map<string, string>): { note: string | null; text: string } {
  const sym = (a: string) => symbols.get(a.toLowerCase()) ?? a;
  try {
    switch (kind) {
      case "AmendNotional": {
        const [token, increase, units] = decodeAbiParameters([{ type: "address" }, { type: "bool" }, { type: "uint256" }], args);
        return { note: sym(token), text: `${increase ? "Increase" : "Reduce"} by ${units} units` };
      }
      case "SetTrustedIssuer": {
        const [token, issuer, topics] = decodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256[]" }], args);
        return { note: sym(token), text: topics.length ? `Trust ${nameOf(m, issuer)}` : `Cease to trust ${nameOf(m, issuer)}` };
      }
      case "CorrectDetermination": {
        const [c] = decodeAbiParameters([{ type: "tuple", components: [
          { name: "token", type: "address" }, { name: "dateIndex", type: "uint256" }, { name: "levels", type: "uint256[]" },
          { name: "outcome", type: "tuple", components: [
            { name: "breached", type: "bool" }, { name: "couponPaid", type: "bool" }, { name: "couponPerCa", type: "uint64" },
            { name: "redeemed", type: "bool" }, { name: "redemptionPerCa", type: "uint64" }, { name: "worstIndex", type: "uint8" },
          ] },
          { name: "signature", type: "bytes" }, { name: "holders", type: "address[]" },
        ] }], args);
        const o = c.outcome;
        const said = [o.couponPaid ? `coupon ${o.couponPerCa} cents per Calculation Amount` : "no coupon", o.redeemed ? `redemption at ${o.redemptionPerCa} cents` : null, o.breached ? "barrier breached" : null].filter(Boolean).join(", ");
        return { note: sym(c.token), text: `Date ${Number(c.dateIndex) + 1} to Levels ${c.levels.join(", ")}: ${said}${c.holders.length ? `; reverses ${c.holders.length} holder${c.holders.length === 1 ? "" : "s"}' payment` : ""}` };
      }
      case "RetireNote": {
        const [token] = decodeAbiParameters([{ type: "address" }], args);
        return { note: sym(token), text: "Retire it and release its registry" };
      }
      case "SetLiquidityProvider": {
        const [a, approved] = decodeAbiParameters([{ type: "address" }, { type: "bool" }], args);
        return { note: null, text: `${approved ? "Approve" : "Remove"} ${nameOf(m, a)}` };
      }
      default: {
        const note = ON_A_NOTE.includes(kind) ? sym(decodeAbiParameters([{ type: "address" }], args.slice(0, 66) as Hex)[0]) : null;
        return { note, text: args.length > 66 ? `${args.slice(0, 66)}…` : args };
      }
    }
  } catch {
    return { note: null, text: args };
  }
}

/** A party's name from the manifest, or its address. */
export function nameOf(m: Manifest, a: string): string {
  const issuers = m.identity ? { "the bank's claim issuer": m.identity.bankIssuer, "the onboarding agent's claim issuer": m.identity.onboardingIssuer } : {};
  const parties = { ...(m.parties ?? {}), ...Object.fromEntries(Object.entries(m.custody?.accounts ?? {})), ...issuers } as Record<string, string>;
  const hit = Object.entries(parties).find(([, v]) => String(v).toLowerCase() === a.toLowerCase());
  return hit ? hit[0] : a;
}

/** The governance console, for the note chosen: the deployment's own note where none is. */
export async function governanceView(token?: string): Promise<GovernanceView> {
  const c = context();
  const pc = c.s.publicClient;
  const read = <T>(functionName: any, args: readonly unknown[] = []) => pc.readContract({ address: c.g.controller, abi: CONTROLLER, functionName, args } as any) as Promise<T>;
  const notes = await governedNotes();
  if (!notes.length) throw new Error("The controller governs no note yet.");
  const chosen = notes.find((n) => n.address.toLowerCase() === (token ?? "").toLowerCase()) ?? notes[0];
  const g = await read<{ trustedIssuers: Address; determinations: Address; inventory: Address }>("governed", [chosen.address]);
  const [minI, minS, delay, recovery, window, count, block, total, inventory, paused, next, trustedIssuers, servicingWallet, calculationAgent, funder] = await Promise.all([
    read<bigint>("MIN_INSTITUTIONS"),
    read<bigint>("MIN_SIGNATURES"),
    read<number>("TIER2_DELAY"),
    read<number>("RECOVERY_DELAY"),
    read<number>("EXECUTION_WINDOW"),
    read<bigint>("proposalCount"),
    pc.getBlock(),
    pc.readContract({ address: chosen.address, abi: TOKEN, functionName: "totalSupply" }),
    pc.readContract({ address: chosen.address, abi: TOKEN, functionName: "balanceOf", args: [g.inventory] }),
    pc.readContract({ address: chosen.address, abi: TOKEN, functionName: "paused" }),
    pc.readContract({ address: g.determinations, abi: DETERMINATIONS, functionName: "nextDate" }),
    pc.readContract({ address: g.trustedIssuers, abi: ISSUERS, functionName: "getTrustedIssuers" }),
    read<Address>("servicingWallet"),
    read<Address>("calculationAgent"),
    read<Address>("funder"),
  ]);
  const chainNow = Number(block.timestamp);
  const symbols = new Map(notes.map((n) => [n.address.toLowerCase(), n.symbol]));
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
    const expiresAt = readyAt ? readyAt + Number(window) : null;
    const state: ProposalView["state"] = p.executed ? "executed" : p.cancelled ? "cancelled" : !readyAt ? "awaiting approvals" : expiresAt !== null && chainNow > expiresAt ? "expired" : chainNow >= readyAt ? "executable" : "queued";
    const d = describe(kind, p.args, c.m, symbols);
    proposals.push({
      id,
      kind,
      label: KIND_LABEL[kind],
      note: d.note,
      args: d.text,
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
    executionWindow: Number(window),
    targetTier2Delay: c.g.targetTier2Delay ?? null,
    targetExecutionWindow: c.g.targetExecutionWindow ?? null,
    institutions,
    roles: { servicingWallet, calculationAgent, funder },
    proposals,
    tier1: logs
      .map((l) => ({
        note: l.args.token === zeroAddress ? "every note" : (symbols.get(String(l.args.token).toLowerCase()) ?? String(l.args.token)),
        action: l.args.action!,
        reason: l.args.reason!,
        tx: l.transactionHash,
        block: Number(l.blockNumber),
      }))
      .reverse(),
    notes,
    note: { ...chosen, total: String(total), inventory: String(inventory), paused, nextDate: Number(next), determinations: g.determinations },
    trustedIssuers: [...trustedIssuers],
    pool: Boolean(c.m.venue),
  };
}

/**
 * The accounts a note can act on, with their units of it, for the console's choices: the
 * deployment's own parties by their capacity, and every account onboarded on the site by the bank's
 * client it was confirmed against, its route beside it.
 */
export async function parties(token?: string): Promise<Array<{ name: string; address: Address; units: string }>> {
  const c = context();
  const note = (token ?? (await governedNotes())[0]?.address) as Address | undefined;
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
  const units = await Promise.all(rows.map((r) => (note ? c.s.publicClient.readContract({ address: note, abi: TOKEN, functionName: "balanceOf", args: [r.address] }).catch(() => 0n) : Promise.resolve(0n))));
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

async function governedNote(c: Ctx, token: string): Promise<GovernedNote> {
  const n = (await governedNotes()).find((x) => x.address.toLowerCase() === token.toLowerCase());
  if (!n) throw new Error("Choose a note the controller governs.");
  return n;
}

/** Tier 1: the Agent's governance wallet corrects one note's register, at once, with its reason. */
export async function correctRegister(staff: Registrant, input: { token: Address; from: Address; to: Address; units: number; reason: string }): Promise<Hex> {
  staffOnly(staff);
  const reason = needReason(input.reason);
  if (!Number.isInteger(input.units) || input.units < 1) throw new Error("Correct at least one unit.");
  if (input.from.toLowerCase() === input.to.toLowerCase()) throw new Error("Choose two different accounts.");
  const c = context();
  const note = await governedNote(c, input.token);
  const held = await c.s.publicClient.readContract({ address: note.address, abi: TOKEN, functionName: "balanceOf", args: [input.from] });
  if (held < BigInt(input.units)) throw new Error(`${nameOf(c.m, input.from)} holds ${held} units of ${note.symbol}, not ${input.units}.`);
  const tx = await asInstitution(c, "agent", encodeFunctionData({ abi: CONTROLLER, functionName: "correctRegister", args: [note.address, input.from, input.to, BigInt(input.units), reason] }));
  await audit(staff, `Tier 1: corrected the register of ${note.symbol}, ${input.units} units from ${nameOf(c.m, input.from)} to ${nameOf(c.m, input.to)}: ${reason}`, tx);
  return tx;
}

/**
 * Tier 1: the Agent's governance wallet freezes or unfreezes an account on one note or every note,
 * designates it under the programme's sanctions or lifts that, or withdraws or restores its pool access.
 */
export async function withdraw(
  staff: Registrant,
  input: { what: "freeze" | "unfreeze" | "designate" | "undesignate" | "pool" | "restore-pool"; account: Address; token?: Address; everyNote?: boolean; reason: string },
): Promise<Hex> {
  staffOnly(staff);
  const reason = needReason(input.reason);
  const c = context();
  let data: Hex;
  let scope = "";
  if (input.what === "pool" || input.what === "restore-pool") {
    data = encodeFunctionData({ abi: CONTROLLER, functionName: input.what === "pool" ? "withdrawPoolAccess" : "restorePoolAccess", args: [input.account, reason] });
  } else if (input.what === "designate" || input.what === "undesignate") {
    data = encodeFunctionData({ abi: CONTROLLER, functionName: "designate", args: [input.account, input.what === "designate", reason] });
  } else {
    const notes = input.everyNote ? await governedNotes() : [await governedNote(c, input.token ?? "")];
    scope = input.everyNote ? " on every note" : ` on ${notes[0].symbol}`;
    data = encodeFunctionData({ abi: CONTROLLER, functionName: "freezeAccount", args: [notes.map((n) => n.address), input.account, input.what === "freeze", reason] });
  }
  const tx = await asInstitution(c, "agent", data);
  const said = { pool: "withdrew pool access of", "restore-pool": "restored pool access of", freeze: "froze", unfreeze: "unfroze", designate: "designated under sanctions", undesignate: "lifted the sanctions designation of" }[input.what];
  await audit(staff, `Tier 1: ${said} ${nameOf(c.m, input.account)}${scope}: ${reason}`, tx);
  return tx;
}

/**
 * Tier 1: the Agent's governance wallet recovers a holder's units from a lost wallet to its new
 * one, on every note the lost wallet holds; its identity moves with them. Refused while any of
 * those notes has transfers stopped at a record time.
 */
export async function recoverWallet(staff: Registrant, input: { lost: Address; replacement: Address; reason: string }): Promise<Hex> {
  staffOnly(staff);
  const reason = needReason(input.reason);
  if (input.lost.toLowerCase() === input.replacement.toLowerCase()) throw new Error("Choose a new wallet.");
  const c = context();
  const pc = c.s.publicClient;
  const notes = await governedNotes();
  const held = await Promise.all(notes.map((n) => pc.readContract({ address: n.address, abi: TOKEN, functionName: "balanceOf", args: [input.lost] })));
  const holding = notes.filter((_, i) => held[i] > 0n);
  if (!holding.length) throw new Error(`${nameOf(c.m, input.lost)} holds no units of any note.`);
  const registry = await pc.readContract({ address: holding[0].address, abi: TOKEN, functionName: "identityRegistry" });
  const identity = await pc.readContract({ address: registry, abi: REGISTRY, functionName: "identity", args: [input.lost] });
  if (/^0x0{40}$/i.test(identity)) throw new Error(`${nameOf(c.m, input.lost)} has no identity on record.`);
  const tx = await asInstitution(c, "agent", encodeFunctionData({ abi: CONTROLLER, functionName: "recoverWallet", args: [holding.map((n) => n.address), input.lost, input.replacement, identity, reason] }));
  await audit(staff, `Tier 1: recovered the units of ${nameOf(c.m, input.lost)} on ${holding.map((n) => n.symbol).join(", ")} to ${input.replacement}: ${reason}`, tx);
  return tx;
}

/** Tier 1: the Agent's governance wallet cancels units from the Issuer's inventory of a note. Callers check the staff member. */
export async function cancelInventoryTier1(token: Address, units: number, reason: string): Promise<Hex> {
  const c = context();
  return asInstitution(c, "agent", encodeFunctionData({ abi: CONTROLLER, functionName: "cancelInventory", args: [token, BigInt(units), needReason(reason)] }));
}

/**
 * What correcting a note's latest determination to `levels` would do, for the page to show before
 * anything is proposed: the corrected outcome, and whether the coupon paid on it is reversed.
 */
export async function previewCorrection(token: Address, levels: bigint[]) {
  const c = context();
  const pc = c.s.publicClient;
  const g = await pc.readContract({ address: c.g.controller, abi: CONTROLLER, functionName: "governed", args: [token] });
  const next = await pc.readContract({ address: g.determinations, abi: DETERMINATIONS, functionName: "nextDate" });
  if (next === 0n) throw new Error("No date of this note has been determined yet.");
  const k = next - 1n;
  const [was, outcome] = await Promise.all([
    pc.readContract({ address: g.determinations, abi: DETERMINATIONS, functionName: "outcomeOf", args: [k] }),
    pc.readContract({ address: g.determinations, abi: DETERMINATIONS, functionName: "computeCorrection", args: [k, levels] }).catch((e) => {
      throw new Error(/InvalidLevels/.test(String(e)) ? "Give one positive whole-number Level for each underlying." : refusal(e));
    }),
  ]);
  const [redemption, coupon] = await Promise.all([
    pc.readContract({ address: g.payingAgent, abi: PAYING, functionName: "idOf", args: [k, REDEMPTION] }).then((id) => pc.readContract({ address: g.payingAgent, abi: PAYING, functionName: "distributions", args: [id] })),
    pc.readContract({ address: g.payingAgent, abi: PAYING, functionName: "idOf", args: [k, COUPON] }).then(async (id) => ({ id, d: await pc.readContract({ address: g.payingAgent, abi: PAYING, functionName: "distributions", args: [id] }) })),
  ]);
  if (redemption[4]) throw new Error("This date's redemption has already started paying, so its determination can no longer be corrected.");
  if (coupon.d[4] && !coupon.d[5]) throw new Error("This date's coupon is still being paid. Finish paying it, then correct it.");
  return { g, dateIndex: k, was, outcome, coupon: { id: coupon.id, recordTime: Number(coupon.d[0]), entitled: coupon.d[2], closed: coupon.d[5] } };
}

/** The holders a closed coupon paid or held for: those its reversal recovers from. */
async function paidHolders(c: Ctx, payingAgent: Address, id: Hex): Promise<Address[]> {
  const { client, from } = await ledgerFrom().catch(() => ({ client: c.s.publicClient, from: 0n }));
  const [paid, held] = await Promise.all([
    client.getLogs({ address: payingAgent, event: PAID, args: { id }, fromBlock: from, toBlock: "latest" }),
    client.getLogs({ address: payingAgent, event: HELD, args: { id }, fromBlock: from, toBlock: "latest" }),
  ]);
  return [...new Set([...paid, ...held].map((l) => l.args.holder!.toLowerCase()))] as Address[];
}

/** Tier 2: an institution proposes one of the acts offered from the site. */
export async function propose(
  staff: Registrant,
  input: { by: InstitutionKey; kind: Kind; reason: string; token?: Address; increase?: boolean; units?: number; account?: Address; approved?: boolean; levels?: bigint[] },
): Promise<{ tx: Hex; id: number }> {
  staffOnly(staff);
  const reason = needReason(input.reason);
  if (!OFFERED.includes(input.kind)) throw new Error(`${KIND_LABEL[input.kind]} is not offered from the site: the institutions propose it from their own wallets.`);
  const c = context();
  const note = ON_A_NOTE.includes(input.kind) || input.kind === "CorrectDetermination" ? await governedNote(c, input.token ?? "") : null;
  let data: Hex;
  let detail = "";
  if (input.kind === "AmendNotional") {
    if (!Number.isInteger(input.units) || (input.units ?? 0) < 1) throw new Error("Amend by at least one unit.");
    data = encodeFunctionData({ abi: CONTROLLER, functionName: "proposeAmendNotional", args: [note!.address, Boolean(input.increase), BigInt(input.units!), reason] });
  } else if (input.kind === "SetTrustedIssuer") {
    if (!input.account) throw new Error("Give the claim issuer's address.");
    data = encodeFunctionData({ abi: CONTROLLER, functionName: "proposeSetTrustedIssuer", args: [note!.address, input.account, input.approved ? [NOTE_TOPIC] : [], reason] });
  } else if (input.kind === "CorrectDetermination") {
    const levels = input.levels ?? [];
    if (!levels.length || levels.some((l) => l <= 0n)) throw new Error("Give one positive whole-number Level for each underlying.");
    const p = await previewCorrection(note!.address, levels);
    // The Calculation Agent signs the corrected Levels and outcome, as it signs every determination.
    const digest = await c.s.publicClient.readContract({ address: p.g.determinations, abi: DETERMINATIONS, functionName: "digest", args: [p.dateIndex, levels, p.outcome] });
    const signature = await c.s.signHash("calculationAgent", digest);
    const holders = p.coupon.closed ? await paidHolders(c, p.g.payingAgent, p.coupon.id) : [];
    data = encodeFunctionData({
      abi: CONTROLLER,
      functionName: "proposeCorrectDetermination",
      args: [{ token: note!.address, dateIndex: p.dateIndex, levels, outcome: p.outcome, signature, holders }, reason],
    });
    detail = ` date ${Number(p.dateIndex) + 1}`;
  } else if (input.kind === "RetireNote") {
    data = encodeFunctionData({ abi: CONTROLLER, functionName: "proposeRetireNote", args: [note!.address, reason] });
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
  await audit(staff, `Tier 2 proposal ${id} by the ${label}: ${KIND_LABEL[input.kind]}${note ? ` of ${note.symbol}${detail}` : ""}: ${reason}`, tx);
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

/**
 * Where executing a correction pays a coupon again, the funder approves the Paying Agent for exactly
 * the restated amount first: the corrected amount on the units the original coupon was entitled to.
 */
async function fundRestatement(c: Ctx, args: Hex): Promise<Hex | null> {
  const [corr] = decodeAbiParameters([{ type: "tuple", components: [
    { name: "token", type: "address" }, { name: "dateIndex", type: "uint256" }, { name: "levels", type: "uint256[]" },
    { name: "outcome", type: "tuple", components: [
      { name: "breached", type: "bool" }, { name: "couponPaid", type: "bool" }, { name: "couponPerCa", type: "uint64" },
      { name: "redeemed", type: "bool" }, { name: "redemptionPerCa", type: "uint64" }, { name: "worstIndex", type: "uint8" },
    ] },
    { name: "signature", type: "bytes" }, { name: "holders", type: "address[]" },
  ] }], args);
  if (!corr.outcome.couponPaid) return null;
  const pc = c.s.publicClient;
  const g = await pc.readContract({ address: c.g.controller, abi: CONTROLLER, functionName: "governed", args: [corr.token] });
  const id = await pc.readContract({ address: g.payingAgent, abi: PAYING, functionName: "idOf", args: [corr.dateIndex, COUPON] });
  const d = await pc.readContract({ address: g.payingAgent, abi: PAYING, functionName: "distributions", args: [id] });
  if (!d[5]) return null; // not paid yet: the correction restates nothing
  const amount = BigInt(corr.outcome.couponPerCa) * BigInt(d[2]);
  const funder = await pc.readContract({ address: g.payingAgent, abi: PAYING, functionName: "FUNDER" });
  if (funder.toLowerCase() !== c.s.address("agent").toLowerCase()) throw new Error(`The funder of distributions is ${funder}, whose key the site does not hold.`);
  const deposit = c.m.assets.deposit!.address as Address;
  const tx = await c.s.send("agent", { address: deposit, abi: CASH, functionName: "approve", args: [g.payingAgent, amount] });
  await until(() => pc.readContract({ address: deposit, abi: CASH, functionName: "allowance", args: [funder, g.payingAgent] }), (a) => a >= amount);
  return tx;
}

/** Tier 2: executes a queued proposal after its delay and within its window. Anyone may; the Agent's key sends. */
export async function execute(staff: Registrant, id: number): Promise<Hex> {
  staffOnly(staff);
  const c = context();
  const p = await c.s.publicClient.readContract({ address: c.g.controller, abi: CONTROLLER, functionName: "proposal", args: [BigInt(id)] });
  if (KINDS[p.kind] === "CorrectDetermination") await fundRestatement(c, p.args);
  const data = encodeFunctionData({ abi: CONTROLLER, functionName: "execute", args: [BigInt(id)] });
  await c.s.publicClient.call({ account: c.s.address("agent"), to: c.g.controller, data }).catch((e) => {
    throw new Error(refusal(e));
  });
  const tx = await c.s.send("agent", { address: c.g.controller, abi: CONTROLLER, functionName: "execute", args: [BigInt(id)] });
  await until(() => c.s.publicClient.readContract({ address: c.g.controller, abi: CONTROLLER, functionName: "proposal", args: [BigInt(id)] }), (x) => x.executed);
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
 * The Agent attempting a forced transfer outside the control framework, simulated as its servicing
 * wallet on the note chosen. Nothing is sent; the note's refusal is returned, with who does hold the right.
 */
export async function attemptAgentForcedTransfer(staff: Registrant, token?: Address): Promise<string> {
  staffOnly(staff);
  const c = context();
  const note = token ? await governedNote(c, token) : (await governedNotes())[0];
  const from = c.m.parties.investorA as Address;
  const to = c.m.parties.investorB as Address;
  const data = encodeFunctionData({ abi: TOKEN, functionName: "forcedTransfer", args: [from, to, 1n] });
  const servicingWallet = await c.s.publicClient.readContract({ address: c.g.controller, abi: CONTROLLER, functionName: "servicingWallet" });
  const [servicing, controller] = await Promise.all(
    [servicingWallet, c.g.controller].map(async (who) => {
      const agent = await c.s.publicClient.readContract({ address: note.address, abi: TOKEN, functionName: "isAgent", args: [who] });
      if (!agent) return false;
      const r = await c.s.publicClient.readContract({ address: note.address, abi: TOKEN, functionName: "getAgentRestrictions", args: [who] });
      return !r.disableForceTransfer;
    }),
  );
  try {
    await c.s.publicClient.call({ account: servicingWallet, to: note.address, data });
  } catch (e) {
    await audit(staff, `Attempted a forced transfer of ${note.symbol} as the Agent's servicing wallet, outside the control framework: refused`, note.address);
    return `${refusal(e)} The servicing wallet may force a transfer: ${servicing ? "yes" : "no"}; the controller: ${controller ? "yes" : "no"}.`;
  }
  throw new Error("The note allowed the Agent's servicing wallet to force a transfer: the control framework is not in force.");
}
