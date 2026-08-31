import "server-only";
import { decodeFunctionData, formatUnits, type Abi, type Address, type Hex } from "viem";
import { publicClient, addresses, KEYS, type Addresses } from "./chain";
import { privateKeyToAccount } from "viem/accounts";
import {
  TREX_TOKEN_ABI,
  IDENTITY_REGISTRY_WRITE_ABI,
  IDENTITY_ABI,
  ID_FACTORY_ABI,
  TREX_MINT_ABI,
  CHECKER_ABI,
  ADAPTER_ABI,
  ROUTER_ABI,
  CUSTODY_ACCOUNT_ABI,
  MODULAR_COMPLIANCE_ABI,
  MAX_BALANCE_MODULE_ABI,
  DEMO_BASELINE_ABI,
  ERC20_ABI,
  PERMIT2_ABI,
} from "./abis";

/**
 * The audit trail, read from the chain rather than kept by this app.
 *
 * That distinction is the point worth making to an audience: there is no application log
 * here that could disagree with reality. Every row is a transaction that was mined, decoded
 * from its own calldata.
 *
 * Approach: find transactions that touched the demo's contracts (via their logs, which is far
 * cheaper than scanning blocks), then decode each one's input against the known ABIs. Calls
 * routed through a custody account are unwrapped one level, so the row shows what the
 * custodian actually instructed rather than an opaque `executeOne`.
 */

const DECODE_ABIS: Abi[] = [
  TREX_TOKEN_ABI as unknown as Abi,
  IDENTITY_REGISTRY_WRITE_ABI as unknown as Abi,
  IDENTITY_ABI as unknown as Abi,
  ID_FACTORY_ABI as unknown as Abi,
  TREX_MINT_ABI as unknown as Abi,
  CHECKER_ABI as unknown as Abi,
  ADAPTER_ABI as unknown as Abi,
  ROUTER_ABI as unknown as Abi,
  CUSTODY_ACCOUNT_ABI as unknown as Abi,
  MODULAR_COMPLIANCE_ABI as unknown as Abi,
  MAX_BALANCE_MODULE_ABI as unknown as Abi,
  DEMO_BASELINE_ABI as unknown as Abi,
  ERC20_ABI as unknown as Abi,
  PERMIT2_ABI as unknown as Abi,
];

/** Operations worth surfacing, with plain-English descriptions and a significance tier. */
const MEANING: Record<string, { text: string; tone: "control" | "trade" | "onboard" | "ops" }> = {
  setAddressFrozen: { text: "Froze or unfroze an investor's wallet", tone: "control" },
  freezePartialTokens: { text: "Immobilised part of a holding", tone: "control" },
  unfreezePartialTokens: { text: "Released a partial freeze", tone: "control" },
  pause: { text: "Paused the asset — all transfers and trading halted", tone: "control" },
  unpause: { text: "Unpaused the asset", tone: "control" },
  forcedTransfer: { text: "Forced a transfer without the holder's signature", tone: "control" },
  mint: { text: "Issued new units", tone: "onboard" },
  registerIdentity: { text: "Registered an investor as a holder of record", tone: "onboard" },
  createIdentityWithManagementKeys: { text: "Minted an on-chain identity", tone: "onboard" },
  addClaim: { text: "Attested a claim (KYC) on an identity", tone: "onboard" },
  setCountryEnforcement: { text: "Toggled the venue jurisdiction overlay", tone: "control" },
  setCountryAllowed: { text: "Allowed or blocked a jurisdiction at the venue", tone: "control" },
  setCountriesAllowed: { text: "Set permitted jurisdictions in bulk", tone: "control" },
  registerAsset: { text: "Registered an asset with the compliance bridge", tone: "ops" },
  updateSwappingEnabled: { text: "Enabled or disabled trading on the adapter", tone: "control" },
  addModule: { text: "Bound a compliance module", tone: "control" },
  removeModule: { text: "Unbound a compliance module", tone: "control" },
  callModuleFunction: { text: "Configured a compliance module", tone: "control" },
  setMaxBalance: { text: "Set the per-holder concentration limit", tone: "control" },
  execute: { text: "Executed a swap through the permissioned router", tone: "trade" },
  executeOne: { text: "Custodian acted for a client account", tone: "trade" },
  arm: { text: "Armed the demo reset baseline", tone: "ops" },
  approve: { text: "Set a token approval", tone: "ops" },
  depositForVerification: { text: "Seeded the adapter to prove allow-listing", tone: "ops" },
};

export type ActivityRow = {
  txHash: Hex;
  block: number;
  from: string;
  fromAddress: Address;
  target: string;
  targetAddress: Address;
  fn: string;
  args: string[];
  meaning: string;
  tone: "control" | "trade" | "onboard" | "ops";
  /** Set when the call was routed through a custody account. */
  via?: string;
};

function labelMap(a: Addresses): Map<string, string> {
  const m = new Map<string, string>();
  const put = (addr: string | undefined, label: string) => {
    if (addr) m.set(addr.toLowerCase(), label);
  };

  put(a.trex.token, `${a.trex.tokenSymbol} token`);
  put(a.trex.identityRegistry, "Identity registry");
  put(a.trex.modularCompliance, "Modular compliance");
  put(a.trex.claimIssuer, "Claim issuer");
  put(a.trex.idFactory, "ONCHAINID factory");
  put(a.trex.modules?.maxBalance, "Max-balance module");
  put(a.trex.modules?.countryAllow, "Country-allow module");
  put(a.trex.modules?.supplyLimit, "Supply-limit module");
  put(a.venue.allowlistChecker, "Compliance bridge");
  put(a.venue.hook, "Compliance hook");
  put(a.venue.permissionsAdapter, "Permissions adapter");
  put(a.venue.router, "Permissioned router");
  put(a.venue.positionManager, "Position manager");
  put(a.venue.usdc, "USDC");
  put(a.venue.permit2, "Permit2");
  put(a.ops?.demoBaseline, "Demo baseline");

  for (const i of a.investors ?? []) put(i.wallet, i.name);
  for (const c of a.custodyClients ?? []) put(c.account, c.name);
  for (const c of a.custodyPending ?? []) put(c.account, c.name);
  put(a.roles?.issuer, "Issuer");
  put(a.roles?.agent, "Transfer agent");
  put(a.roles?.claimSigner, "KYC provider");
  put(a.roles?.unverified, "Dave");
  put(a.custody?.custodian, "Custodian");

  // Signing accounts, so the "who" column reads as a role.
  for (const [role, pk] of Object.entries(KEYS)) {
    const addr = privateKeyToAccount(pk as Hex).address.toLowerCase();
    if (!m.has(addr)) m.set(addr, role === "agent" ? "Transfer agent" : role === "claimSigner" ? "KYC provider" : role[0].toUpperCase() + role.slice(1));
  }
  return m;
}

/**
 * Some calls carry an encoded payload that is meaningless on screen. Show what it is rather
 * than a truncated hex blob.
 */
const ARG_OVERRIDE: Record<string, (args: readonly unknown[]) => string[]> = {
  execute: () => ["«encoded swap plan»"],
  callModuleFunction: (args) => {
    const inner = tryDecode(args[0] as Hex);
    return inner ? [`${inner.fn}(${inner.args.map(String).join(", ")})`] : ["«module call»"];
  },
  addClaim: (args) => [`topic ${String(args[0])}`, "scheme 1", "«issuer»", "«signature»", "«claim data»"],
  createIdentityWithManagementKeys: (args) => [String(args[0]), String(args[1]), "«1 management key»"],
};

function renderArg(value: unknown, labels: Map<string, string>, decimals: number): string {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) {
    const label = labels.get(value.toLowerCase());
    return label ? `${label}` : `${value.slice(0, 6)}…${value.slice(-4)}`;
  }
  if (typeof value === "bigint") {
    // Amounts in this demo are either token units or small integers.
    if (value > 10n ** 12n) return `${formatUnits(value, decimals)}`;
    return value.toString();
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" && value.length > 24) return `${value.slice(0, 12)}…`;
  if (Array.isArray(value)) return `[${value.length} items]`;
  return String(value);
}

function tryDecode(input: Hex): { fn: string; args: readonly unknown[] } | null {
  for (const abi of DECODE_ABIS) {
    try {
      const d = decodeFunctionData({ abi, data: input });
      if (d?.functionName) return { fn: d.functionName, args: (d.args ?? []) as readonly unknown[] };
    } catch {
      /* next abi */
    }
  }
  return null;
}

export async function recentActivity(limit = 18): Promise<ActivityRow[]> {
  const a = addresses();
  const labels = labelMap(a);
  const decimals = a.trex.decimals;

  const watched: Address[] = [
    a.trex.token,
    a.trex.identityRegistry,
    a.trex.modularCompliance,
    a.trex.idFactory,
    a.venue.allowlistChecker,
    a.venue.hook,
    a.venue.permissionsAdapter,
    a.venue.router,
    ...(a.ops?.demoBaseline ? [a.ops.demoBaseline] : []),
    ...(a.custodyClients ?? []).map((c) => c.account),
    ...(a.custodyPending ?? []).map((c) => c.account),
  ];

  const logs = await publicClient.getLogs({ address: watched, fromBlock: 0n, toBlock: "latest" });

  // Newest first, then unique transactions until we have enough.
  logs.sort((x, y) => {
    const b = Number(y.blockNumber ?? 0n) - Number(x.blockNumber ?? 0n);
    return b !== 0 ? b : Number(y.logIndex ?? 0) - Number(x.logIndex ?? 0);
  });

  const seen = new Set<string>();
  const hashes: Array<{ hash: Hex; block: number }> = [];
  for (const l of logs) {
    if (!l.transactionHash || seen.has(l.transactionHash)) continue;
    seen.add(l.transactionHash);
    hashes.push({ hash: l.transactionHash, block: Number(l.blockNumber ?? 0n) });
    if (hashes.length >= limit * 2) break;
  }

  const rows: ActivityRow[] = [];
  for (const { hash, block } of hashes) {
    if (rows.length >= limit) break;
    let tx;
    try {
      tx = await publicClient.getTransaction({ hash });
    } catch {
      continue;
    }
    if (!tx?.to || !tx.input || tx.input === "0x") continue;

    const decoded = tryDecode(tx.input as Hex);
    if (!decoded) continue;

    let fn = decoded.fn;
    let args = decoded.args;
    let target = tx.to as Address;
    let via: string | undefined;

    // Unwrap a custody-account call so the row shows the instruction the custodian gave,
    // not the envelope it travelled in. `executeOne(target, value, data)`.
    if (fn === "executeOne" && args.length === 3) {
      const inner = tryDecode(args[2] as Hex);
      if (inner) {
        via = labels.get((tx.to as string).toLowerCase()) ?? "custody account";
        target = args[0] as Address;
        fn = inner.fn;
        args = inner.args;
      }
    }

    const meta = MEANING[fn];
    if (!meta) continue;

    rows.push({
      txHash: hash,
      block,
      from: labels.get(tx.from.toLowerCase()) ?? `${tx.from.slice(0, 6)}…${tx.from.slice(-4)}`,
      fromAddress: tx.from,
      target: labels.get(target.toLowerCase()) ?? `${target.slice(0, 6)}…${target.slice(-4)}`,
      targetAddress: target,
      fn,
      args: ARG_OVERRIDE[fn]
        ? ARG_OVERRIDE[fn](args).map((x) =>
            /^0x[0-9a-fA-F]{40}$/.test(x) ? renderArg(x, labels, decimals) : x,
          )
        : args.map((v) => renderArg(v, labels, decimals)),
      meaning: meta.text,
      tone: meta.tone,
      via,
    });
  }

  return rows;
}
