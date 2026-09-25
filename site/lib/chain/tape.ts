import {
  decodeFunctionData,
  formatUnits,
  getAddress,
  keccak256,
  toBytes,
  parseAbiItem,
  toFunctionSelector,
  type AbiFunction,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { addressBook, type Manifest } from "./manifest.ts";

/**
 * The audit tape: what was instructed on-chain, decoded from each transaction's calldata.
 *
 * Three properties matter more than presentation, because an audit tape that is quietly
 * incomplete is the worst failure this audience can meet.
 *
 * - A call is identified by the contract it was sent to and its selector together. Two tokens
 *   share `mint`, `transfer` and `approve`; keyed by name alone they are indistinguishable.
 * - Nothing is dropped. A call the registry does not know becomes a row marked unrecognised,
 *   with its selector and full calldata, so a gap in the registry is visible on the tape.
 * - Arguments are rendered from what the registry says they are. An amount is formatted with
 *   the decimals of the token it is denominated in, never guessed from its size, and text is
 *   shown whole, so a written intervention reason is never cut off.
 *
 * Calls made through a custody account are unwrapped, one row per inner call, so the row shows
 * the instruction the Custodian gave rather than the envelope it travelled in.
 */

export type Tone = "control" | "trade" | "onboard" | "ops" | "unrecognised";

/**
 * How an argument is shown. `amount` is in units of the called token; `amountOf` is in units of
 * the token passed at that argument index.
 */
export type ArgSpec =
  | "account"
  | "amount"
  | { amountOf: number }
  | "flag"
  | "number"
  | "text"
  | "reason"
  | "plan"
  | "poolKey"
  | "grantFlags"
  | "time"
  | "ref"
  | "role"
  | "levels"
  | "outcome"
  | "signature"
  | "kind"
  | "accounts"
  | { amountIn: string }
  | "calls";

export type Entry = { signature: string; meaning: string; tone: Tone; args: ArgSpec[] };

/** Role administration, on every contract that uses role-based access control. */
const ROLES: Entry[] = [
  { signature: "function grantRole(bytes32 role, address account)", meaning: "Granted a role", tone: "control", args: ["role", "account"] },
  { signature: "function revokeRole(bytes32 role, address account)", meaning: "Revoked a role", tone: "control", args: ["role", "account"] },
  { signature: "function renounceRole(bytes32 role, address account)", meaning: "Renounced a role", tone: "control", args: ["role", "account"] },
];

/** The note and the deposit share the adapted composition, so they share these. */
const ADAPTED_TOKEN: Entry[] = [
  ...ROLES,
  { signature: "function mint(address account, uint256 value)", meaning: "Issued units", tone: "onboard", args: ["account", "amount"] },
  { signature: "function burn(address account, uint256 value)", meaning: "Burned units", tone: "control", args: ["account", "amount"] },
  { signature: "function transfer(address to, uint256 value)", meaning: "Transferred units", tone: "trade", args: ["account", "amount"] },
  { signature: "function transferFrom(address from, address to, uint256 value)", meaning: "Transferred units under an allowance", tone: "trade", args: ["account", "account", "amount"] },
  { signature: "function approve(address spender, uint256 value)", meaning: "Set an allowance", tone: "ops", args: ["account", "amount"] },
  { signature: "function pause()", meaning: "Paused the instrument: all transfers halted", tone: "control", args: [] },
  { signature: "function unpause()", meaning: "Unpaused the instrument", tone: "control", args: [] },
  { signature: "function setAddressFrozen(address account, bool isFrozen)", meaning: "Froze or unfroze an account", tone: "control", args: ["account", "flag"] },
  { signature: "function setFrozenTokens(address account, uint256 amount)", meaning: "Set the frozen part of a holding", tone: "control", args: ["account", "amount"] },
  { signature: "function forcedTransfer(address from, address to, uint256 amount)", meaning: "Forced a transfer without the holder's signature", tone: "control", args: ["account", "account", "amount"] },
  { signature: "function forcedTransfer(address from, address to, uint256 value, bytes data)", meaning: "Forced a transfer without the holder's signature, with a written reason", tone: "control", args: ["account", "account", "amount", "reason"] },
  { signature: "function setRuleEngine(address ruleEngine)", meaning: "Replaced the instrument's gate", tone: "control", args: ["account"] },
  { signature: "function setSnapshotEngine(address snapshotEngine)", meaning: "Attached the record-date engine", tone: "control", args: ["account"] },
  { signature: "function upgradeToAndCall(address newImplementation, bytes data)", meaning: "Upgraded the instrument's implementation", tone: "control", args: ["account", "plan"] },
];

/** Contract kinds, each with the calls the tape knows for it. */
export const REGISTRY: Record<string, Entry[]> = {
  restrictedAsset: [
    { signature: "function setEligible(address account, bool eligible)", meaning: "Set an account's eligibility to hold the asset", tone: "onboard", args: ["account", "flag"] },
    { signature: "function mint(address to, uint256 amount)", meaning: "Issued units", tone: "onboard", args: ["account", "amount"] },
    { signature: "function pause()", meaning: "Paused the asset: all transfers and trading halted", tone: "control", args: [] },
    { signature: "function unpause()", meaning: "Unpaused the asset", tone: "control", args: [] },
    { signature: "function setFrozenTokens(address account, uint256 amount)", meaning: "Set the frozen part of a holding", tone: "control", args: ["account", "amount"] },
    { signature: "function forcedTransfer(address from, address to, uint256 amount)", meaning: "Forced a transfer without the holder's signature", tone: "control", args: ["account", "account", "amount"] },
    { signature: "function transfer(address to, uint256 amount)", meaning: "Transferred units", tone: "trade", args: ["account", "amount"] },
    { signature: "function approve(address spender, uint256 amount)", meaning: "Set an allowance on the asset", tone: "ops", args: ["account", "amount"] },
  ],
  cash: [
    { signature: "function mint(address to, uint256 amount)", meaning: "Issued test cash", tone: "ops", args: ["account", "amount"] },
    { signature: "function transfer(address to, uint256 amount)", meaning: "Transferred cash", tone: "trade", args: ["account", "amount"] },
    { signature: "function approve(address spender, uint256 amount)", meaning: "Set an allowance on cash", tone: "ops", args: ["account", "amount"] },
  ],
  checker: [
    { signature: "function registerAsset(address token)", meaning: "Registered an asset with the checker", tone: "ops", args: ["account"] },
    { signature: "function unregisterAsset(address token)", meaning: "Removed an asset from the checker", tone: "control", args: ["account"] },
    { signature: "function setLiquidityRestricted(address token, bool restricted)", meaning: "Set whether providing liquidity needs venue approval", tone: "control", args: ["account", "flag"] },
    { signature: "function setLiquidityApproved(address token, address account, bool approved)", meaning: "Set an account's approval to provide liquidity", tone: "control", args: ["account", "account", "flag"] },
  ],
  adapter: [
    { signature: "function updateAllowedWrapper(address wrapper, bool allowed)", meaning: "Allowed or refused a wrapper (router or position manager) on the adapter", tone: "control", args: ["account", "flag"] },
    { signature: "function updateAllowedHook(address hook, bool allowed)", meaning: "Allowed or refused a hook on the adapter", tone: "control", args: ["account", "flag"] },
    { signature: "function updateSwappingEnabled(bool enabled)", meaning: "Switched trading of the asset on or off", tone: "control", args: ["flag"] },
    { signature: "function updateAllowListChecker(address checker)", meaning: "Replaced the adapter's checker", tone: "control", args: ["account"] },
    { signature: "function depositForVerification(uint256 amount)", meaning: "Placed a balance in the adapter for verification", tone: "ops", args: ["number"] },
  ],
  adapterFactory: [
    { signature: "function createPermissionsAdapter(address token, address owner, address checker)", meaning: "Wrapped an asset in a permissions adapter", tone: "ops", args: ["account", "account", "account"] },
    { signature: "function verifyPermissionsAdapter(address adapter)", meaning: "Verified a permissions adapter", tone: "ops", args: ["account"] },
  ],
  poolManager: [
    { signature: "function initialize((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96)", meaning: "Opened a pool", tone: "control", args: ["poolKey", "number"] },
  ],
  router: [
    { signature: "function execute(bytes unlockData, uint256 deadline)", meaning: "Swapped through the permissioned router", tone: "trade", args: ["plan", "number"] },
  ],
  positionManager: [
    { signature: "function modifyLiquidities(bytes unlockData, uint256 deadline)", meaning: "Changed a liquidity position", tone: "trade", args: ["plan", "number"] },
  ],
  permit2: [
    { signature: "function approve(address token, address spender, uint160 amount, uint48 expiration)", meaning: "Set a Permit2 allowance", tone: "ops", args: ["account", "account", { amountOf: 0 }, "number"] },
  ],
  note: ADAPTED_TOKEN,
  deposit: ADAPTED_TOKEN,
  registry: [
    ...ROLES,
    { signature: "function setRegistrar(address issuingKey, uint16 registrar)", meaning: "Appointed or removed a registrar's issuing key", tone: "control", args: ["account", "number"] },
    { signature: "function setMaxValidity(uint40 maxValidity)", meaning: "Set the longest a grant may run, in seconds", tone: "control", args: ["number"] },
    { signature: "function grant(address account, uint32 flags, uint16 jurisdiction, uint40 expiresAt, bytes32 credentialRef, bytes32 commitment)", meaning: "Granted eligibility after a verified presentation", tone: "onboard", args: ["account", "grantFlags", "number", "time", "ref", "ref"] },
    { signature: "function revoke(address account)", meaning: "Revoked an account's eligibility", tone: "control", args: ["account"] },
    { signature: "function withdraw(address account, string reason)", meaning: "Withdrew an account's eligibility under supervisory authority, with a written reason", tone: "control", args: ["account", "text"] },
  ],
  gateway: [
    ...ROLES,
    { signature: "function credit(address account, uint256 amount, bytes32 bookingRef)", meaning: "Created deposit on credit to an account", tone: "onboard", args: ["account", { amountIn: "deposit" }, "ref"] },
    { signature: "function debit(address account, uint256 amount, bytes32 bookingRef)", meaning: "Extinguished deposit on debit from an account", tone: "onboard", args: ["account", { amountIn: "deposit" }, "ref"] },
  ],
  determinations: [
    { signature: "function determine(uint256 dateIndex, uint256[] levels, (bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex) claimed, bytes signature)", meaning: "Accepted the Calculation Agent's determination: two computations agreed", tone: "control", args: ["number", "levels", "outcome", "signature"] },
  ],
  payingAgent: [
    ...ROLES,
    { signature: "function open(uint256 dateIndex, uint8 kind)", meaning: "Opened a distribution and debited its cash from the Agent", tone: "trade", args: ["number", "kind"] },
    { signature: "function pay(bytes32 id, address[] holders)", meaning: "Paid holders of record at the Record Time", tone: "trade", args: ["ref", "accounts"] },
    { signature: "function claim(bytes32 id, address holder)", meaning: "Paid an amount held for a holder the deposit could not credit", tone: "trade", args: ["ref", "account"] },
    { signature: "function reverse(bytes32 id, address[] holders, string reason)", meaning: "Reversed a distribution, holder by holder, with a written reason", tone: "control", args: ["ref", "accounts", "text"] },
    { signature: "function restate(bytes32 original, uint48 recordTime, string reason)", meaning: "Restated a reversed distribution against a corrected Record Time", tone: "control", args: ["ref", "time", "text"] },
  ],
  settlement: [
    { signature: "function propose(address seller, address buyer, uint64 units, uint256 price, uint48 deadline)", meaning: "Proposed a delivery-versus-payment trade", tone: "trade", args: ["account", "account", { amountIn: "note" }, { amountIn: "deposit" }, "time"] },
    { signature: "function accept(uint256 id)", meaning: "Accepted a trade: both legs settled together", tone: "trade", args: ["number"] },
    { signature: "function cancel(uint256 id)", meaning: "Cancelled a proposed trade", tone: "ops", args: ["number"] },
  ],
  controller: [
    { signature: "function correctRegister(address from, address to, uint256 units, string reason)", meaning: "Tier 1: corrected the register to match the Register", tone: "control", args: ["account", "account", { amountIn: "note" }, "text"] },
    { signature: "function withdrawGrant(address account, string reason)", meaning: "Tier 1: withdrew a grant under supervisory authority", tone: "control", args: ["account", "text"] },
    { signature: "function proposeUpgrade(address token, address implementation, string reason)", meaning: "Tier 2 proposal: upgrade an instrument", tone: "control", args: ["account", "account", "text"] },
    { signature: "function proposeReplaceGate(address token, address gate, string reason)", meaning: "Tier 2 proposal: replace an instrument's gate", tone: "control", args: ["account", "account", "text"] },
    { signature: "function proposeAmendNotional(bool increase, uint256 units, string reason)", meaning: "Tier 2 proposal: amend the notional in the Issuer's inventory", tone: "control", args: ["flag", { amountIn: "note" }, "text"] },
    { signature: "function proposeReverseDistribution(bytes32 distribution, address[] holders, string reason)", meaning: "Tier 2 proposal: reverse a distribution", tone: "control", args: ["ref", "accounts", "text"] },
    { signature: "function proposeRestateDistribution(bytes32 original, uint48 recordTime, string reason)", meaning: "Tier 2 proposal: restate a distribution", tone: "control", args: ["ref", "time", "text"] },
    { signature: "function proposeSetRegistrar(address issuingKey, uint16 registrar, string reason)", meaning: "Tier 2 proposal: appoint or remove a registrar's issuing key", tone: "control", args: ["account", "number", "text"] },
    { signature: "function proposeSetMaxValidity(uint40 maxValidity, string reason)", meaning: "Tier 2 proposal: set the longest a grant may run, in seconds", tone: "control", args: ["number", "text"] },
    { signature: "function proposeReplaceServicingWallet(address newWallet, string reason)", meaning: "Tier 2 proposal: replace the Agent's servicing wallet", tone: "control", args: ["account", "text"] },
    { signature: "function proposeReplaceInstitution(address oldWallet, address newWallet, string reason)", meaning: "Recovery proposal: replace an institution's wallet", tone: "control", args: ["account", "account", "text"] },
    { signature: "function approve(uint256 id)", meaning: "Approved a Tier 2 proposal", tone: "control", args: ["number"] },
    { signature: "function execute(uint256 id)", meaning: "Executed a Tier 2 proposal after its delay", tone: "control", args: ["number"] },
    { signature: "function cancel(uint256 id)", meaning: "Cancelled a Tier 2 proposal", tone: "control", args: ["number"] },
  ],
  wallet: [
    { signature: "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)", meaning: "A multi-signature wallet acted", tone: "control", args: ["account", "number", "plan", "number", "number", "number", "number", "account", "account", "signature"] },
  ],
  walletFactory: [
    { signature: "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce)", meaning: "Created a multi-signature wallet", tone: "ops", args: ["account", "plan", "number"] },
  ],
  custodyFactory: [
    { signature: "function createAccount(string clientRef)", meaning: "Opened a segregated client account", tone: "onboard", args: ["text"] },
  ],
  custodyAccount: [
    { signature: "function executeOne(address target, uint256 value, bytes data)", meaning: "Custodian acted for a client account", tone: "trade", args: ["account", "number", "plan"] },
    { signature: "function execute((address target, uint256 value, bytes data)[] calls)", meaning: "Custodian acted for a client account", tone: "trade", args: ["calls"] },
  ],
};

/** Which registry kind each manifest key is. Assets not listed here are unrecognised. */
const KIND_OF_KEY: Record<string, string> = {
  "assets.venueAsset": "restrictedAsset",
  "assets.cash": "cash",
  "venue.allowlistChecker": "checker",
  "venue.permissionsAdapter": "adapter",
  "venue.adapterFactory": "adapterFactory",
  "venue.router": "router",
  "venue.positionManager": "positionManager",
  "venue.permit2": "permit2",
  "venue.poolManager": "poolManager",
  "custody.factory": "custodyFactory",
  "assets.note": "note",
  "assets.deposit": "deposit",
  "instruments.registry": "registry",
  "instruments.gateway": "gateway",
  "lifecycle.determinations": "determinations",
  "lifecycle.payingAgent": "payingAgent",
  "lifecycle.settlement": "settlement",
  "governance.controller": "controller",
  "governance.walletFactory": "walletFactory",
  "governance.agentGovernance": "wallet",
  "governance.issuerGovernance": "wallet",
  "governance.cosigner": "wallet",
  "governance.servicingWallet": "wallet",
};

function kindOfKey(key: string): string | undefined {
  if (key.startsWith("custody.accounts.")) return "custodyAccount";
  return KIND_OF_KEY[key];
}

/** The maximum of each allowance width in use: an allowance without limit, not an amount. */
const UNLIMITED = new Set([(1n << 256n) - 1n, (1n << 160n) - 1n]);

type Compiled = { entry: Entry; item: AbiFunction };

function compile(registry: Record<string, Entry[]>): Map<string, Compiled> {
  const out = new Map<string, Compiled>();
  for (const [kind, entries] of Object.entries(registry)) {
    for (const entry of entries) {
      const item = parseAbiItem(entry.signature) as AbiFunction;
      if (item.inputs.length !== entry.args.length) {
        throw new Error(`tape registry: ${kind} ${entry.signature} declares ${entry.args.length} argument kinds`);
      }
      const id = `${kind}:${toFunctionSelector(item)}`;
      if (out.has(id)) throw new Error(`tape registry: ${id} is registered twice`);
      out.set(id, { entry, item });
    }
  }
  return out;
}

export type Call = { to: Address; input: Hex };

export type TapeRow = {
  txHash: Hex;
  block: number;
  from: string;
  target: string;
  targetAddress: Address;
  /** The function name, or the selector when unrecognised. */
  fn: string;
  args: string[];
  meaning: string;
  tone: Tone;
  recognised: boolean;
  /** The custody account a call was made through. */
  via?: string;
};

export class Tape {
  private readonly manifest: Manifest;
  private readonly book: ReturnType<typeof addressBook>;
  private readonly compiled: Map<string, Compiled>;

  constructor(manifest: Manifest, registry: Record<string, Entry[]> = REGISTRY) {
    this.manifest = manifest;
    this.book = addressBook(manifest);
    this.compiled = compile(registry);
  }

  /** A deployment. Shown, like everything else, rather than skipped. */
  describeCreation(tx: { hash: Hex; block: number; from: Address }, created?: Address): TapeRow {
    return {
      txHash: tx.hash,
      block: tx.block,
      from: this.label(tx.from),
      target: created ? this.label(created) : "new contract",
      targetAddress: created ? getAddress(created) : "0x0000000000000000000000000000000000000000",
      fn: "(deployment)",
      args: [],
      meaning: "Deployed a contract",
      tone: "ops",
      recognised: true,
    };
  }

  /** Rows for one transaction. Always at least one. */
  describe(tx: { hash: Hex; block: number; from: Address; to: Address; input: Hex }): TapeRow[] {
    const base = { txHash: tx.hash, block: tx.block, from: this.label(tx.from) };
    const outer = this.decode({ to: tx.to, input: tx.input });
    if (outer.compiled && outer.kind === "wallet") {
      // A wallet transaction is shown as the act it carried, signed by the wallet.
      const [to, , data] = outer.args as [Address, bigint, Hex];
      const inner = { to, input: data };
      return [{ ...base, ...this.row(inner, this.decode(inner)), via: this.label(tx.to) }];
    }
    if (!outer.compiled || outer.kind !== "custodyAccount") return [{ ...base, ...this.row({ to: tx.to, input: tx.input }, outer) }];

    // Unwrap the envelope into the calls it carried.
    const via = this.label(tx.to);
    const args = outer.args!;
    const inner: Call[] =
      outer.compiled.item.name === "executeOne"
        ? [{ to: args[0] as Address, input: args[2] as Hex }]
        : (args[0] as Array<{ target: Address; data: Hex }>).map((c) => ({ to: c.target, input: c.data }));
    return inner.map((c) => ({ ...base, ...this.row(c, this.decode(c)), via }));
  }

  private decode(call: Call): { kind?: string; compiled?: Compiled; args?: readonly unknown[] } {
    const kind = this.kindOf(call.to);
    if (!kind || call.input.length < 10) return { kind };
    const compiled = this.compiled.get(`${kind}:${call.input.slice(0, 10).toLowerCase()}`);
    if (!compiled) return { kind };
    try {
      const { args } = decodeFunctionData({ abi: [compiled.item], data: call.input });
      return { kind, compiled, args: args ?? [] };
    } catch {
      return { kind };
    }
  }

  private row(call: Call, d: ReturnType<Tape["decode"]>): Omit<TapeRow, "txHash" | "block" | "from"> {
    const target = { target: this.label(call.to), targetAddress: getAddress(call.to) };
    if (!d.compiled) {
      return {
        ...target,
        fn: call.input.slice(0, 10),
        args: [call.input],
        meaning: d.kind
          ? `Unrecognised call to a known contract: the tape's registry has no entry for this selector on ${d.kind}`
          : "Unrecognised call to a contract the manifest does not name",
        tone: "unrecognised",
        recognised: false,
      };
    }
    const { entry, item } = d.compiled;
    const args = d.args!;
    return {
      ...target,
      fn: item.name,
      args: entry.args.map((spec, i) => this.render(spec, args[i], call.to, args)),
      meaning: entry.meaning,
      tone: entry.tone,
      recognised: true,
    };
  }

  private render(spec: ArgSpec, value: unknown, target: Address, all: readonly unknown[]): string {
    if (spec === "account") return this.label(value as Address);
    if (spec === "amount") return this.amount(value as bigint, target);
    if (typeof spec === "object" && "amountOf" in spec) return this.amount(value as bigint, all[spec.amountOf] as Address);
    if (typeof spec === "object") {
      const t = this.manifest.assets[spec.amountIn];
      return t ? this.amount(value as bigint, t.address) : `${(value as bigint).toString()} base units`;
    }
    if (spec === "grantFlags") return grantFlags(Number(value));
    if (spec === "levels") return `[${(value as bigint[]).map(String).join(", ")}]`;
    if (spec === "outcome") return outcome(value as Record<string, unknown>);
    if (spec === "signature") return `«signature, ${((value as Hex).length - 2) / 2} bytes»`;
    if (spec === "kind") return Number(value) === 0 ? "coupon" : "redemption";
    if (spec === "accounts") return `[${(value as Address[]).map((x) => this.label(x)).join(", ")}]`;
    if (spec === "time") return new Date(Number(value) * 1000).toISOString();
    if (spec === "ref") return ref(value as Hex);
    if (spec === "role") return ROLE_NAMES.get((value as string).toLowerCase()) ?? (value as string);
    if (spec === "flag") return value ? "true" : "false";
    if (spec === "number") return (value as bigint | number).toString();
    if (spec === "text") return JSON.stringify(value as string);
    if (spec === "reason") return reason(value as Hex);
    if (spec === "plan") return `«encoded plan, ${((value as Hex).length - 2) / 2} bytes»`;
    if (spec === "poolKey") {
      const k = value as { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
      return `${this.label(k.currency0)} / ${this.label(k.currency1)}, fee ${k.fee}, spacing ${k.tickSpacing}, hook ${this.label(k.hooks)}`;
    }
    return `[${(value as unknown[]).length} calls]`;
  }

  /** Formatted in the token's own decimals, or as a raw integer when the token is not known. */
  private amount(value: bigint, token: Address): string {
    const t = Object.values(this.manifest.assets).find((a) => same(a.address, token));
    if (UNLIMITED.has(value)) return `unlimited ${t?.symbol ?? "base units"}`;
    if (!t) return `${value.toString()} base units`;
    return `${formatUnits(value, t.decimals)} ${t.symbol}`;
  }

  private kindOf(addr: Address): string | undefined {
    const hit = this.book.get(addr.toLowerCase());
    return hit ? kindOfKey(hit.key) : undefined;
  }

  label(addr: Address): string {
    return this.book.get(addr.toLowerCase())?.label ?? getAddress(addr);
  }

  /** Every contract address the manifest names; the set whose events locate transactions. */
  watched(): Address[] {
    return [...this.book.entries()].filter(([, v]) => !v.key.startsWith("parties.")).map(([a]) => getAddress(a));
  }
}

/** A determination's outcome, in cents per Calculation Amount. */
function outcome(o: Record<string, unknown>): string {
  const cents = (v: unknown) => `EUR ${(Number(v) / 100).toFixed(2)}`;
  const parts = [
    o.couponPaid ? `coupon ${cents(o.couponPerCa)} per CA` : "no coupon",
    o.redeemed ? `redeems at ${cents(o.redemptionPerCa)} per CA` : "no redemption",
    o.breached ? "barrier breached" : "no breach",
    `worst performer ${String(o.worstIndex)}`,
  ];
  return parts.join("; ");
}

/** The Identity Registry's flag bits, by name. Unknown bits are shown, not dropped. */
const GRANT_FLAGS: Array<[number, string]> = [
  [1 << 0, "HOLD"], [1 << 1, "RECEIVE"], [1 << 2, "TRANSFER"], [1 << 3, "SWAP"], [1 << 4, "PROVIDE_LIQUIDITY"],
  [1 << 8, "REG_S"], [1 << 9, "RULE_144A"], [1 << 10, "PROFESSIONAL"], [1 << 11, "ACCREDITED"], [1 << 12, "QIB"],
  [1 << 13, "SANCTIONS_CLEAR"], [1 << 14, "CONTRACT_ACCOUNT"], [1 << 15, "SETTLEMENT"],
];

export function grantFlags(flags: number): string {
  const names = GRANT_FLAGS.filter(([bit]) => flags & bit).map(([, n]) => n);
  const known = GRANT_FLAGS.reduce((m, [bit]) => m | bit, 0);
  const rest = flags & ~known;
  if (rest) names.push(`0x${rest.toString(16)}`);
  return names.length ? names.join("|") : "none";
}

const ROLE_NAMES = new Map<string, string>([
  ["0x0000000000000000000000000000000000000000000000000000000000000000", "DEFAULT_ADMIN_ROLE"],
  ...[
    "MINTER_ROLE", "BURNER_ROLE", "PAUSER_ROLE", "ENFORCER_ROLE", "ERC20ENFORCER_ROLE", "SNAPSHOOTER_ROLE",
    "DOCUMENT_ROLE", "EXTRA_INFORMATION_ROLE", "FORCED_TRANSFER_ROLE", "PROXY_UPGRADE_ROLE", "DEPOSIT_AGENT_ROLE", "SUPERVISOR_ROLE",
  ].map((r) => [keccak256(toBytes(r)), r] as [string, string]),
]);

/** A 32-byte reference: text when it is printable text padded with zeros, otherwise hex. */
export function ref(value: Hex): string {
  const bytes = Buffer.from(value.slice(2), "hex");
  const end = bytes.indexOf(0) === -1 ? bytes.length : bytes.indexOf(0);
  const head = bytes.subarray(0, end);
  const printable = end > 0 && head.every((b) => b >= 0x20 && b < 0x7f) && bytes.subarray(end).every((b) => b === 0);
  return printable ? JSON.stringify(head.toString("latin1")) : value;
}

/** A reason payload shown as text when it is UTF-8, and in full hex when it is not. */
export function reason(data: Hex): string {
  const bytes = Buffer.from(data.slice(2), "hex");
  try {
    return JSON.stringify(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return data;
  }
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The most recent transactions, as tape rows, newest first.
 *
 * Transactions are located by the events the manifest's contracts emitted, which is cheap on
 * any node. A transaction that emitted no such event does not appear: in particular a reverted
 * one. That coverage limit is stated here rather than hidden; closing it needs an indexer that
 * reads every transaction sent to a watched address.
 */
export async function readTape(client: PublicClient, tape: Tape, limit = 20): Promise<TapeRow[]> {
  const logs = await client.getLogs({ address: tape.watched(), fromBlock: 0n, toBlock: "latest" });
  logs.sort((x, y) => Number((y.blockNumber ?? 0n) - (x.blockNumber ?? 0n)) || (y.logIndex ?? 0) - (x.logIndex ?? 0));

  const seen = new Set<Hex>();
  const rows: TapeRow[] = [];
  for (const log of logs) {
    if (!log.transactionHash || seen.has(log.transactionHash)) continue;
    seen.add(log.transactionHash);
    if (seen.size > limit) break;
    const tx = await client.getTransaction({ hash: log.transactionHash });
    const at = { hash: tx.hash, block: Number(tx.blockNumber), from: tx.from };
    if (!tx.to) {
      const receipt = await client.getTransactionReceipt({ hash: tx.hash });
      rows.push(tape.describeCreation(at, receipt.contractAddress ?? undefined));
      continue;
    }
    rows.push(...tape.describe({ ...at, to: tx.to, input: tx.input }));
  }
  return rows;
}
