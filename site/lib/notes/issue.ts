import "server-only";
import { randomBytes } from "node:crypto";
import { defineChain, encodeAbiParameters, keccak256, maxUint256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { loadManifest, type Manifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";
import { getStore, type DemoNote, type Registrant } from "../store.ts";
import { hasRole } from "../operators.ts";
import { until } from "../chain/until.ts";
import artifacts from "./artifacts.json" with { type: "json" };
import scenarios from "./scenarios.json" with { type: "json" };
import { calendar as calendarOf, calendarProblem, stretch, type Interval } from "./calendar.ts";

/**
 * Issuing a note (ADRs 0072, 0073, 0088): the same contracts as the note under review, a scenario's
 * terms, and a calendar staff choose at issuance. The token and its registries are issued as one
 * T-REX suite through T-REX's factory, on the deployment's identity storage and its fixed
 * implementations, so the note runs the very code under review; the lifecycle contracts are then
 * attached as agents restricted to their own powers (ADR 0085). Issuance is a sequence of single
 * transactions, each recorded as it lands, so the page that starts it can follow it to the end
 * and a failed step can be run again.
 *
 * Roles follow the issuance script: the Issuer owns the note, mints into its inventory and holds
 * it; the Agent funds; the Calculation Agent determines; the Agent's servicing wallet pays.
 */

export type Scenario = (typeof scenarios)[number];
export const SCENARIOS: Scenario[] = scenarios;

const NOTE = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function onchainID() view returns (address)",
  "function identityRegistry() view returns (address)",
  "function compliance() view returns (address)",
  "function mint(address to, uint256 amount)",
  "function unpause()",
  "function addAgent(address agent)",
  "function isAgent(address agent) view returns (bool)",
  "function setAgentRestrictions(address agent, (bool disableMint, bool disableBurn, bool disablePartialFreeze, bool disableAddressFreeze, bool disableRecovery, bool disableForceTransfer, bool disablePause) restrictions)",
]);
const TREX_FACTORY = parseAbi([
  "function deployTREXSuite(string salt, (address owner, string name, string symbol, uint8 decimals, address irs, address ONCHAINID, address[] irAgents, address[] tokenAgents, address[] complianceModules, bytes[] complianceSettings) tokenDetails, (uint256[] claimTopics, address[] issuers, uint256[][] issuerClaims) claimDetails)",
  "function getToken(string salt) view returns (address)",
]);
const IDENTITY = parseAbi([
  "function addClaim(uint256 topic, uint256 scheme, address issuer, bytes signature, bytes data, string uri) returns (bytes32)",
  "function getClaim(bytes32 claimId) view returns (uint256 topic, uint256 scheme, address issuer, bytes signature, bytes data, string uri)",
]);
const DEPOSIT = parseAbi([
  "function setAllowlisted(address account, bool allowed)",
  "function approve(address spender, uint256 value) returns (bool)",
]);
const GATEWAY = parseAbi(["function credit(address account, uint256 amount, bytes32 bookingRef)"]);

const TOPIC = {
  note: BigInt(keccak256(toBytes("claim.note-eligible"))),
  termSheet: BigInt(keccak256(toBytes("claim.term-sheet"))),
};

/** Every power off, then those named on (ADR 0085). */
function only(...on: Array<"mint" | "burn" | "partialFreeze" | "pause">) {
  return {
    disableMint: !on.includes("mint"),
    disableBurn: !on.includes("burn"),
    disablePartialFreeze: !on.includes("partialFreeze"),
    disableAddressFreeze: true,
    disableRecovery: true,
    disableForceTransfer: true,
    disablePause: !on.includes("pause"),
  };
}

const now = () => new Date().toISOString();

function context() {
  const m = loadManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  if (!m.identity) throw new Error("the manifest has no identity scaffolding: deploy 0.2.0");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, id: m.identity, s: signers(chain, rpc) };
}

const art = (name: keyof typeof artifacts) => ({ abi: artifacts[name].abi as readonly unknown[], bytecode: artifacts[name].bytecode as Hex });

/** The note's observations and the time between them; notes issued before ADR 0073 had four, minutes apart. */
const shapeOf = (n: DemoNote): { observations: number; interval: Interval } =>
  n.interval && n.observations ? { observations: n.observations, interval: n.interval } : { observations: 4, interval: { value: n.spacingMinutes ?? 10, unit: "minutes" } };

type Ctx = ReturnType<typeof context> & { n: DemoNote; scenario: Scenario };
type Step = { label: string; run: (c: Ctx) => Promise<Partial<DemoNote> | void> };

const tx = (key: string, hash: Hex) => (n: DemoNote) => ({ txs: { ...n.txs, [key]: hash } });
const asNote = (c: Ctx, key: string, functionName: string, args: readonly unknown[], capacity = "issuer") =>
  c.s.send(capacity, { address: c.n.addresses.note, abi: NOTE, functionName, args }).then((h) => tx(key, h)(c.n));

/** The issuance, step by step, as IssueNote.s.sol and Issuance.sol do it. */
const STEPS: Step[] = [
  {
    label: "Fix the terms and the calendar (Determination Agent)",
    run: async (c) => {
      const block = await c.s.publicClient.getBlock();
      const shape = shapeOf(c.n);
      const calendar = calendarOf(Number(block.timestamp), shape.observations, shape.interval);
      const stretched = stretch(c.scenario, shape.observations);
      const t = c.scenario.terms;
      const terms = {
        initialLevels: t.initialLevels.map(BigInt),
        calculationAmountCents: BigInt(t.calculationAmountCents),
        couponBarrierBps: t.couponBarrierBps,
        couponRateBps: t.couponRateBps,
        memory_: t.memory,
        barrierBps: t.barrierBps,
        twinWin: t.twinWin,
        schedule: stretched.schedule.map((o, k) => ({ date: calendar[k].date, recordTime: calendar[k].recordTime, paymentDate: calendar[k].paymentDate, coupon: o.coupon, mer: o.mer, barrier: o.barrier, isFinal: o.isFinal, merTriggerBps: o.merTriggerBps })),
      };
      const { address, hash } = await c.s.deploy("issuer", { ...art("DeterminationAgent"), args: [terms, c.s.address("calculationAgent")] });
      return { calendar, addresses: { ...c.n.addresses, determinations: address }, ...tx("determinations", hash)(c.n) };
    },
  },
  {
    label: "Deploy the record-date module (the note's compliance)",
    run: async (c) => {
      const { address, hash } = await c.s.deploy("issuer", { ...art("RecordDateModule"), args: [c.n.addresses.determinations] });
      return { addresses: { ...c.n.addresses, recordDates: address }, ...tx("recordDates", hash)(c.n) };
    },
  },
  {
    label: "Issue the note's T-REX suite: token, identity registry, compliance",
    run: async (c) => {
      const salt = c.n.id;
      const details = {
        owner: c.s.address("issuer"),
        name: c.n.name,
        symbol: c.n.symbol,
        decimals: 0,
        irs: c.id.identityStorage,
        ONCHAINID: "0x0000000000000000000000000000000000000000" as Address,
        irAgents: [c.s.address("accessIssuer")],
        tokenAgents: [c.s.address("issuer")],
        complianceModules: [c.n.addresses.recordDates as Address],
        complianceSettings: [] as Hex[],
      };
      const claims = { claimTopics: [TOPIC.note], issuers: [c.id.onboardingIssuer], issuerClaims: [[TOPIC.note]] };
      const h = await c.s.send("issuer", { address: c.id.trexFactory, abi: TREX_FACTORY, functionName: "deployTREXSuite", args: [salt, details, claims] });
      const note = await until(() => c.s.publicClient.readContract({ address: c.id.trexFactory, abi: TREX_FACTORY, functionName: "getToken", args: [salt] }), (a) => !/^0x0{40}$/i.test(a));
      const [identityRegistry, compliance] = await Promise.all([
        until(() => c.s.publicClient.readContract({ address: note, abi: NOTE, functionName: "identityRegistry" }), (a) => !/^0x0{40}$/i.test(a)),
        c.s.publicClient.readContract({ address: note, abi: NOTE, functionName: "compliance" }),
      ]);
      return { addresses: { ...c.n.addresses, note, identityRegistry, compliance }, ...tx("note", h)(c.n) };
    },
  },
  {
    label: "State the term sheet on the note's identity",
    run: async (c) => {
      // The live note's term sheet: its hash and location, as its own identity states them.
      const live = c.m.assets.note!.address as Address;
      const liveId = await c.s.publicClient.readContract({ address: live, abi: NOTE, functionName: "onchainID" });
      const claimId = (identity: Address) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [identity, TOPIC.termSheet]));
      const [, , , , data, uri] = await c.s.publicClient.readContract({ address: liveId, abi: IDENTITY, functionName: "getClaim", args: [claimId(liveId)] });
      const ownId = await until(() => c.s.publicClient.readContract({ address: c.n.addresses.note as Address, abi: NOTE, functionName: "onchainID" }), (a) => !/^0x0{40}$/i.test(a));
      const h = await c.s.send("issuer", { address: ownId, abi: IDENTITY, functionName: "addClaim", args: [TOPIC.termSheet, 1n, ownId, "0x", data, uri] });
      return { addresses: { ...c.n.addresses, noteIdentity: ownId }, ...tx("termSheet", h)(c.n) };
    },
  },
  {
    label: "Deploy the Paying Agent (paying by the Agent's servicing wallet)",
    run: async (c) => {
      const payer = c.m.governance?.servicingWallet;
      if (!payer) throw new Error("the deployment has no servicing wallet");
      const { address, hash } = await c.s.deploy("issuer", {
        ...art("PayingAgent"),
        args: [c.n.addresses.note, c.m.assets.deposit!.address, c.n.addresses.determinations, c.n.addresses.recordDates, c.s.address("issuer"), c.s.address("agent"), c.s.address("issuer"), payer],
      });
      return { addresses: { ...c.n.addresses, payingAgent: address }, ...tx("payingAgent", hash)(c.n) };
    },
  },
  {
    label: "Deploy the settlement contract (offers locked until they settle)",
    run: async (c) => {
      const { address, hash } = await c.s.deploy("issuer", { ...art("LockedSettlement"), args: [c.n.addresses.note, c.m.assets.deposit!.address] });
      return { addresses: { ...c.n.addresses, settlement: address }, data: { ...c.n.data, settlement: "locked" }, ...tx("settlement", hash)(c.n) };
    },
  },
  { label: "Restrict the Issuer to minting and unpausing", run: (c) => asNote(c, "issuerRestricted", "setAgentRestrictions", [c.s.address("issuer"), only("mint", "pause")]) },
  { label: "Make the Paying Agent an agent of the note", run: (c) => asNote(c, "payingAgentAgent", "addAgent", [c.n.addresses.payingAgent]) },
  { label: "Restrict the Paying Agent to burning and pausing at a redemption", run: (c) => asNote(c, "payingAgentRestricted", "setAgentRestrictions", [c.n.addresses.payingAgent, only("burn", "pause")]) },
  { label: "Make the settlement contract an agent of the note", run: (c) => asNote(c, "settlementAgent", "addAgent", [c.n.addresses.settlement]) },
  { label: "Restrict the settlement contract to locking the units of open offers", run: (c) => asNote(c, "settlementRestricted", "setAgentRestrictions", [c.n.addresses.settlement, only("partialFreeze")]) },
  { label: "Make the Agent an agent of the note", run: (c) => asNote(c, "agentAgent", "addAgent", [c.s.address("agent")]) },
  { label: "Restrict the Agent to cancelling units from the Issuer's inventory", run: (c) => asNote(c, "agentRestricted", "setAgentRestrictions", [c.s.address("agent"), only("burn")]) },
  {
    label: "The bank allowlists the Paying Agent for its deposit",
    run: async (c) => tx("allowPayingAgent", await c.s.send("depositAgent", { address: c.m.assets.deposit!.address, abi: DEPOSIT, functionName: "setAllowlisted", args: [c.n.addresses.payingAgent, true] }))(c.n),
  },
  {
    label: "The bank allowlists the settlement contract for its deposit",
    run: async (c) => tx("allowSettlement", await c.s.send("depositAgent", { address: c.m.assets.deposit!.address, abi: DEPOSIT, functionName: "setAllowlisted", args: [c.n.addresses.settlement, true] }))(c.n),
  },
  {
    label: "Fund the Agent for coupons and redemptions (bank credit)",
    run: async (c) => {
      // Enough to pay every coupon and redeem at the most the scenario can pay: twice the Calculation Amount per unit.
      const amount = BigInt(c.n.units) * BigInt(c.scenario.terms.calculationAmountCents) * 2n;
      const h = await c.s.send("depositAgent", { address: c.m.instruments!.gateway, abi: GATEWAY, functionName: "credit", args: [c.s.address("agent"), amount, keccak256(toBytes(`${c.n.symbol}/funding/${randomBytes(4).toString("hex")}`))] });
      return tx("funding", h)(c.n);
    },
  },
  {
    label: "Let the Paying Agent draw the Agent's funds",
    run: async (c) => tx("allowance", await c.s.send("agent", { address: c.m.assets.deposit!.address, abi: DEPOSIT, functionName: "approve", args: [c.n.addresses.payingAgent, maxUint256] }))(c.n),
  },
  { label: "Mint the notional to the Issuer's inventory", run: (c) => asNote(c, "mint", "mint", [c.s.address("issuer"), BigInt(c.n.units)]) },
  { label: "Open the note for transfers (T-REX issues it paused)", run: (c) => asNote(c, "unpause", "unpause", []) },
];

export const ISSUANCE_STEPS = STEPS.map((s) => s.label);

/** Starts a note; the first step runs at once, the rest as the page asks. */
export async function startNote(staff: Registrant, input: { scenario: string; observations: number; interval: Interval; units: number }): Promise<DemoNote> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  const scenario = SCENARIOS.find((s) => s.name === input.scenario);
  if (!scenario) throw new Error("Choose a scenario.");
  const problem = calendarProblem(input.observations, input.interval);
  if (problem) throw new Error(problem);
  if (!Number.isInteger(input.units) || input.units < 1 || input.units > 100) throw new Error("Issue between 1 and 100 units.");
  const store = getStore();
  const m: Manifest = loadManifest();
  const live = { name: await readLive(m, "name"), symbol: await readLive(m, "symbol") };
  const series = (await store.listNotes()).length + 2; // the live note is series 1
  const n: DemoNote = {
    id: `note_${randomBytes(9).toString("base64url")}`,
    series,
    name: `${live.name}, Series ${series}`,
    symbol: `${live.symbol}${series}`,
    scenario: scenario.name,
    observations: input.observations,
    interval: input.interval,
    units: input.units,
    status: "issuing",
    step: 0,
    createdAt: now(),
    by: staff.email,
    addresses: {},
    txs: {},
    data: {},
  };
  await store.putNote(n);
  await store.audit({ at: now(), actor: staff.email, action: `started issuing ${n.name} (${n.symbol}), scenario ${scenario.name}, ${n.units} units, ${input.observations} observations every ${input.interval.value} ${input.interval.unit}`, subject: n.id });
  return n;
}

async function readLive(m: Manifest, functionName: "name" | "symbol"): Promise<string> {
  const { s } = context();
  return s.publicClient.readContract({ address: m.assets.note!.address as Address, abi: NOTE, functionName });
}

/**
 * Runs the note's next issuance step. Safe to call repeatedly: the step is claimed in the store
 * before it is sent, so two callers cannot both run it; a failed step leaves the note to be retried.
 */
export async function advanceIssuance(id: string): Promise<DemoNote | null> {
  const store = getStore();
  const n = await store.noteById(id);
  if (!n || n.status !== "issuing") return n;
  const step = STEPS[n.step];
  if (!step) {
    const done = { ...n, status: "issued" as const };
    await store.updateNote(done, n.step);
    return done;
  }
  // Claim the step: a negative step marks it in flight, so a second caller does nothing.
  const claimed = { ...n, step: -(n.step + 1), error: undefined };
  if (!(await store.updateNote(claimed, n.step))) return n;
  const scenario = SCENARIOS.find((s) => s.name === n.scenario)!;
  try {
    const patch = (await step.run({ ...context(), n, scenario })) ?? {};
    const next = { ...n, ...patch, step: n.step + 1, error: undefined } as DemoNote;
    if (!STEPS[next.step]) next.status = "issued";
    await store.updateNote(next, claimed.step);
    if (next.status === "issued") await store.audit({ at: now(), actor: "site", action: `issued ${n.name}: ${n.units} units to the Issuer's inventory`, subject: n.id });
    return next;
  } catch (e) {
    // Left at the same step with its error, to run again on the next call. A step whose simulation
    // failed sent nothing; the commonest cause is a lagging RPC that has not yet seen the step before.
    const failed = { ...n, error: `${step.label}: ${(e as Error).message.split("\n")[0]}` };
    await store.updateNote(failed, claimed.step);
    return failed;
  }
}
