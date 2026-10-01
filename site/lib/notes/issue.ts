import "server-only";
import { randomBytes } from "node:crypto";
import { concat, defineChain, encodeAbiParameters, keccak256, maxUint256, parseAbi, parseAbiParameters, toBytes, toFunctionSelector, type Address, type Hex } from "viem";
import { loadManifest, type Manifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";
import { getStore, type DemoNote, type Registrant } from "../store.ts";
import { isOperator } from "../operators.ts";
import artifacts from "./artifacts.json" with { type: "json" };
import scenarios from "./scenarios.json" with { type: "json" };
import { calendar as calendarOf, calendarProblem, stretch, type Interval } from "./calendar.ts";

/**
 * Issuing a note (ADRs 0072, 0073): the same contracts as the note under review, with its
 * own gate and lifecycle contracts, a scenario's terms, and a calendar staff choose at issuance.
 * Issuance is a sequence of single transactions, each recorded as it lands, so the page that
 * starts it can follow it to the end and a failed step can be run again.
 *
 * The note's implementation is not deployed again: the proxy points at the live note's, so the
 * note runs the very code under review. Roles follow the issuance script: the Issuer
 * is admin and holds the inventory, the Agent mints and funds, the Calculation Agent determines,
 * and the Agent's servicing wallet pays.
 */

export type Scenario = (typeof scenarios)[number];
export const SCENARIOS: Scenario[] = scenarios;

const EIP1967_IMPLEMENTATION = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ROLES = parseAbi([
  "function grantRole(bytes32 role, address account)",
  "function renounceRole(bytes32 role, address account)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function BURNER_ROLE() view returns (bytes32)",
  "function PAUSER_ROLE() view returns (bytes32)",
  "function SNAPSHOOTER_ROLE() view returns (bytes32)",
  "function setSnapshotEngine(address engine)",
  "function mint(address account, uint256 value)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function terms() view returns ((string name, (string uri, bytes32 documentHash, uint256 lastModified) doc))",
]);
const REGISTRY = parseAbi([
  "function grant(address account, uint32 flags, uint16 jurisdiction, uint40 expiresAt, bytes32 credentialRef, bytes32 commitment)",
  "function HOLD() view returns (uint32)",
  "function RECEIVE() view returns (uint32)",
  "function TRANSFER() view returns (uint32)",
  "function SANCTIONS_CLEAR() view returns (uint32)",
  "function REG_S() view returns (uint32)",
  "function SETTLEMENT() view returns (uint32)",
  "function CONTRACT_ACCOUNT() view returns (uint32)",
]);
/** The debt standard's initialiser: admin, ERC-20 attributes, extra information (with the terms document), engine. */
const INITIALIZE_SIGNATURE = "initialize(address,(string,string,uint8),(string,(string,string,bytes32),string),(address))";
const GATEWAY = parseAbi(["function credit(address account, uint256 amount, bytes32 bookingRef)"]);

const now = () => new Date().toISOString();

function context() {
  const m = loadManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, s: signers(chain, rpc) };
}

const art = (name: keyof typeof artifacts) => ({ abi: artifacts[name].abi as readonly unknown[], bytecode: artifacts[name].bytecode as Hex });

/** The note's observations and the time between them; notes issued before ADR 0073 had four, minutes apart. */
const shapeOf = (n: DemoNote): { observations: number; interval: Interval } =>
  n.interval && n.observations ? { observations: n.observations, interval: n.interval } : { observations: 4, interval: { value: n.spacingMinutes ?? 10, unit: "minutes" } };

type Ctx = ReturnType<typeof context> & { n: DemoNote; scenario: Scenario };
type Step = { label: string; run: (c: Ctx) => Promise<Partial<DemoNote> | void> };

async function flags(c: Ctx) {
  const r = c.m.instruments!.registry;
  const read = (functionName: "HOLD" | "RECEIVE" | "TRANSFER" | "SANCTIONS_CLEAR" | "REG_S" | "SETTLEMENT" | "CONTRACT_ACCOUNT") =>
    c.s.publicClient.readContract({ address: r, abi: REGISTRY, functionName });
  const [hold, receive, transfer, sanctions, regS, settlement, contract] = await Promise.all(
    (["HOLD", "RECEIVE", "TRANSFER", "SANCTIONS_CLEAR", "REG_S", "SETTLEMENT", "CONTRACT_ACCOUNT"] as const).map(read),
  );
  return { hold, receive, transfer, sanctions, regS, settlement, contract };
}

/**
 * A role's identifier, a constant of the note's implementation, read from the live note, which
 * shares it. Not from the new note: just after its deployment a lagging RPC may not see it yet.
 */
async function role(c: Ctx, name: "MINTER_ROLE" | "BURNER_ROLE" | "PAUSER_ROLE" | "SNAPSHOOTER_ROLE"): Promise<Hex> {
  return c.s.publicClient.readContract({ address: c.m.assets.note!.address as Address, abi: ROLES, functionName: name });
}

/** The debt standard's role for partial freezes: a constant, the same on every note. */
const ERC20ENFORCER_ROLE = keccak256(toBytes("ERC20ENFORCER_ROLE"));

const tx = (key: string, hash: Hex) => (n: DemoNote) => ({ txs: { ...n.txs, [key]: hash } });

/** The issuance, step by step, as IssueNote.s.sol and Lifecycle.sol do it. */
const STEPS: Step[] = [
  {
    label: "Deploy the note's gate",
    run: async (c) => {
      const f = await flags(c);
      const base = f.hold | f.sanctions;
      const { address, hash } = await c.s.deploy("issuer", { ...art("InstrumentGate"), args: [c.m.instruments!.registry, base | f.transfer | f.regS, base | f.receive | f.regS, f.settlement | f.sanctions | f.contract, []] });
      return { addresses: { ...c.n.addresses, gate: address }, ...tx("gate", hash)(c.n) };
    },
  },
  {
    label: "Deploy the note, on the live note's implementation",
    run: async (c) => {
      const live = c.m.assets.note!.address as Address;
      const slot = await c.s.publicClient.getStorageAt({ address: live, slot: EIP1967_IMPLEMENTATION });
      const implementation = `0x${slot!.slice(-40)}` as Address;
      const terms = await c.s.publicClient.readContract({ address: live, abi: ROLES, functionName: "terms" });
      const init = concat([
        toFunctionSelector(`function ${INITIALIZE_SIGNATURE}`),
        encodeAbiParameters(parseAbiParameters("address, (string, string, uint8), (string, (string, string, bytes32), string), (address)"), [
          c.s.address("issuer"),
          [c.n.name, c.n.symbol, 0],
          [c.n.symbol, [terms.name, terms.doc.uri, terms.doc.documentHash], ""],
          [c.n.addresses.gate as Address],
        ]),
      ]);
      const { address, hash } = await c.s.deploy("issuer", { ...art("ERC1967Proxy"), args: [implementation, init] });
      return { addresses: { ...c.n.addresses, note: address, implementation }, ...tx("note", hash)(c.n) };
    },
  },
  {
    label: "Let the Agent mint the inventory",
    run: async (c) => {
      const h = await c.s.send("issuer", { address: c.n.addresses.note, abi: ROLES, functionName: "grantRole", args: [await role(c, "MINTER_ROLE"), c.s.address("agent")] });
      return tx("minter", h)(c.n);
    },
  },
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
    label: "Deploy the record-date engine",
    run: async (c) => {
      const { address, hash } = await c.s.deploy("issuer", { ...art("RecordDateEngine"), args: [c.n.addresses.note, c.n.addresses.determinations] });
      return { addresses: { ...c.n.addresses, recordDates: address }, ...tx("recordDates", hash)(c.n) };
    },
  },
  {
    label: "Attach the record-date engine (grant the snapshot role for it)",
    run: async (c) => tx("snapshooter", await c.s.send("issuer", { address: c.n.addresses.note, abi: ROLES, functionName: "grantRole", args: [await role(c, "SNAPSHOOTER_ROLE"), c.s.address("issuer")] }))(c.n),
  },
  {
    label: "Attach the record-date engine",
    run: async (c) => tx("engine", await c.s.send("issuer", { address: c.n.addresses.note, abi: ROLES, functionName: "setSnapshotEngine", args: [c.n.addresses.recordDates] }))(c.n),
  },
  {
    label: "Renounce the snapshot role again",
    run: async (c) => tx("renounce", await c.s.send("issuer", { address: c.n.addresses.note, abi: ROLES, functionName: "renounceRole", args: [await role(c, "SNAPSHOOTER_ROLE"), c.s.address("issuer")] }))(c.n),
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
    label: "Let the Paying Agent burn redeemed units",
    run: async (c) => tx("burner", await c.s.send("issuer", { address: c.n.addresses.note, abi: ROLES, functionName: "grantRole", args: [await role(c, "BURNER_ROLE"), c.n.addresses.payingAgent] }))(c.n),
  },
  {
    label: "Let the Paying Agent pause the note at a redemption",
    run: async (c) => tx("pauser", await c.s.send("issuer", { address: c.n.addresses.note, abi: ROLES, functionName: "grantRole", args: [await role(c, "PAUSER_ROLE"), c.n.addresses.payingAgent] }))(c.n),
  },
  {
    label: "Deploy the settlement contract (offers locked until they settle)",
    run: async (c) => {
      const { address, hash } = await c.s.deploy("issuer", { ...art("LockedSettlement"), args: [c.n.addresses.note, c.m.assets.deposit!.address] });
      return { addresses: { ...c.n.addresses, settlement: address }, data: { ...c.n.data, settlement: "locked" }, ...tx("settlement", hash)(c.n) };
    },
  },
  {
    label: "Let the settlement contract lock the units of open offers",
    run: async (c) => tx("enforcer", await c.s.send("issuer", { address: c.n.addresses.note, abi: ROLES, functionName: "grantRole", args: [ERC20ENFORCER_ROLE, c.n.addresses.settlement] }))(c.n),
  },
  {
    label: "Let the Agent cancel units from the Issuer's inventory",
    run: async (c) => tx("agentBurner", await c.s.send("issuer", { address: c.n.addresses.note, abi: ROLES, functionName: "grantRole", args: [await role(c, "BURNER_ROLE"), c.s.address("agent")] }))(c.n),
  },
  {
    label: "Onboard the Paying Agent for the cash leg",
    run: async (c) => {
      const f = await flags(c);
      const until = Math.floor(Date.now() / 1000) + 300 * 86_400;
      const h = await c.s.send("accessIssuer", { address: c.m.instruments!.registry, abi: REGISTRY, functionName: "grant", args: [c.n.addresses.payingAgent, f.hold | f.receive | f.transfer | f.sanctions | f.contract, 276, until, keccak256(toBytes(`${c.n.symbol}/paying-agent`)), `0x${"00".repeat(32)}`] });
      return tx("onboardPayingAgent", h)(c.n);
    },
  },
  {
    label: "Onboard the settlement contract",
    run: async (c) => {
      const f = await flags(c);
      const until = Math.floor(Date.now() / 1000) + 300 * 86_400;
      // The settlement right for allowances, and the right to hold the deposit of an offer to buy;
      // never the Regulation S flag the note requires, so it can never hold the note (ADR 0081).
      const h = await c.s.send("accessIssuer", { address: c.m.instruments!.registry, abi: REGISTRY, functionName: "grant", args: [c.n.addresses.settlement, f.settlement | f.sanctions | f.contract | f.hold | f.receive | f.transfer, 276, until, keccak256(toBytes(`${c.n.symbol}/settlement`)), `0x${"00".repeat(32)}`] });
      return tx("onboardSettlement", h)(c.n);
    },
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
    run: async (c) => tx("allowance", await c.s.send("agent", { address: c.m.assets.deposit!.address, abi: ROLES, functionName: "approve", args: [c.n.addresses.payingAgent, maxUint256] }))(c.n),
  },
  {
    label: "Mint the notional to the Issuer's inventory",
    run: async (c) => tx("mint", await c.s.send("agent", { address: c.n.addresses.note, abi: ROLES, functionName: "mint", args: [c.s.address("issuer"), BigInt(c.n.units)] }))(c.n),
  },
];

export const ISSUANCE_STEPS = STEPS.map((s) => s.label);

/** Starts a note; the first step runs at once, the rest as the page asks. */
export async function startNote(staff: Registrant, input: { scenario: string; observations: number; interval: Interval; units: number }): Promise<DemoNote> {
  if (!isOperator(staff.email)) throw new Error("Not permitted.");
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
  return s.publicClient.readContract({ address: m.assets.note!.address as Address, abi: ROLES, functionName });
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
