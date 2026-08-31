import "server-only";
import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodeAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { createNonceManager, privateKeyToAccount } from "viem/accounts";
import { jsonRpc } from "viem/nonce";
import { anvil } from "viem/chains";

export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";

/**
 * Chain id the deployment targets. Defaults to Anvil's 31337 for local runs; set CHAIN_ID
 * when pointing at a hosted chain so transaction signing uses the right value.
 */
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);

export const chain = { ...anvil, id: CHAIN_ID } as const;

/**
 * pollingInterval is set low deliberately.
 *
 * viem defaults to polling every 4 seconds, which is sensible on a public network but absurd
 * against a node that mines on demand: every waitForTransactionReceipt paid up to 4s of dead
 * time. Sign-up alone sends three transactions, so with a handful of people signing up at once
 * that dominated everything else.
 */
const POLLING_INTERVAL = Number(process.env.POLLING_INTERVAL_MS ?? 200);

export const publicClient = createPublicClient({
  chain,
  // JSON-RPC batching matters enormously when the RPC sits behind a tunnel: one console
  // render issues ~100 parallel contract reads, and as individual HTTP requests they each
  // pay the tunnel's round trip. Batched, they collapse into a handful of requests.
  transport: http(RPC_URL, { batch: { wait: 16 } }),
  pollingInterval: POLLING_INTERVAL,
});

/**
 * Anvil's deterministic accounts, mapped to demo roles. These are the publicly documented
 * test keys -- the dashboard signs locally so the demo needs no browser wallet.
 */
const DEFAULT_KEYS = {
  issuer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  agent: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  claimSigner: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  Alice: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  Bob: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  Carol: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  Dave: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  custodian: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
} as const satisfies Record<string, Hex>;

export type RoleName = keyof typeof DEFAULT_KEYS;

/**
 * Signing keys, per role.
 *
 * Local runs use Anvil's published test keys. A hosted deployment overrides them with
 * DEMO_KEYS -- a JSON object of the same shape -- so no key is baked into the bundle.
 *
 * These keys can freeze wallets, pause the asset and move value, so a hosted instance must
 * only ever point at a disposable demo chain holding valueless test assets.
 */
export const KEYS: Record<RoleName, Hex> = (() => {
  const raw = process.env.DEMO_KEYS;
  if (!raw) return DEFAULT_KEYS;
  const parsed = JSON.parse(raw) as Partial<Record<RoleName, Hex>>;
  return { ...DEFAULT_KEYS, ...parsed };
})();

/**
 * Shared nonce manager.
 *
 * Without it, two concurrent transactions from the same signer both read the same pending nonce,
 * so one silently replaces or invalidates the other and the loser's receipt never arrives — the
 * request then hangs until it is abandoned. That is exactly what happens when several people sign
 * up at once, since every sign-up sends transactions as the custodian.
 */
let nonceManager = createNonceManager({ source: jsonRpc() });

/** Accounts are cached so they share nonce state rather than each tracking their own. */
const accountCache = new Map<RoleName, ReturnType<typeof privateKeyToAccount>>();

function accountFor(role: RoleName) {
  let acct = accountCache.get(role);
  if (!acct) {
    acct = privateKeyToAccount(KEYS[role], { nonceManager });
    accountCache.set(role, acct);
  }
  return acct;
}

/**
 * Discards all cached nonce state.
 *
 * Required after an evm_revert: the chain's nonces roll back to the snapshot, but the nonce
 * manager keeps counting from the pre-revert values as a floor — so every later transaction
 * is submitted above a nonce gap and can never mine. The symptom is a receipt timeout on the
 * very next action after a demo reset.
 */
export function resetSigners(): void {
  nonceManager = createNonceManager({ source: jsonRpc() });
  accountCache.clear();
}

export function walletFor(role: RoleName) {
  return createWalletClient({
    account: accountFor(role),
    chain,
    transport: http(RPC_URL),
    pollingInterval: POLLING_INTERVAL,
  });
}

/**
 * Per-signer submission queue.
 *
 * The nonce manager hands out distinct nonces, but transactions still have to reach the node in
 * nonce order or the later ones sit unmined behind a gap. Serialising submission per signer keeps
 * that ordering without serialising the whole request — different signers still proceed in
 * parallel.
 */
const signerQueues = new Map<RoleName, Promise<unknown>>();

function enqueue<T>(role: RoleName, task: () => Promise<T>): Promise<T> {
  const previous = signerQueues.get(role) ?? Promise.resolve();
  const next = previous.then(task, task);
  // Keep the chain going even if a task rejects, but do not retain the rejection.
  signerQueues.set(role, next.catch(() => undefined));
  return next;
}

export type Addresses = {
  chainId: number;
  trex: {
    token: Address;
    identityRegistry: Address;
    modularCompliance: Address;
    claimIssuer: Address;
    idFactory: Address;
    modules: { countryAllow: Address; supplyLimit: Address; maxBalance: Address };
    tokenName: string;
    tokenSymbol: string;
    decimals: number;
  };
  venue: {
    poolManager: Address;
    usdc: Address;
    permit2: Address;
    adapterFactory: Address;
    allowlistChecker: Address;
    hook: Address;
    router: Address;
    positionManager: Address;
    permissionsAdapter: Address;
    liquidityClaimTopic: number;
  };
  pool: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    tickLower: number;
    tickUpper: number;
    hook: Address;
  };
  lens: { stateView: Address };
  ops?: { demoBaseline: Address };
  custody: {
    custodian: Address;
    custodianName: string;
    factory: Address;
    "CLIENT-A": Address;
    "CLIENT-B": Address;
    "CLIENT-C": Address;
    "CLIENT-D": Address;
  };
  custodyClients: Array<{
    ref: string;
    name: string;
    account: Address;
    identity: Address;
    country: number;
    professional: boolean;
    claims: number[];
    custodian: string;
  }>;
  custodyPending: Array<{ ref: string; name: string; account: Address }>;
  /** The fund's own holding of undistributed units. Allocations are transfers out of this. */
  treasury?: {
    ref: string;
    name: string;
    account: Address;
    identity: Address;
    country: number;
    professional: boolean;
    claims: number[];
    custodian: string;
  };
  roles: { issuer: Address; agent: Address; claimSigner: Address; unverified: Address };
  topics: { KYC: number; PROFESSIONAL: number };
  investors: Array<{
    name: string;
    wallet: Address;
    identity: Address;
    country: number;
    professional: boolean;
    claims: number[];
  }>;
};

const ADDRESSES_PATH = path.join(process.cwd(), "..", "ops", "addresses.json");

/**
 * Deployment manifest.
 *
 * Locally this is read fresh from ops/addresses.json on every request, because
 * ops/reset.sh rewrites it and the dashboard must never serve stale addresses.
 *
 * A hosted deployment has no such file -- `..` is outside the Vercel deployment root -- so
 * it supplies the same JSON through ADDRESSES_JSON instead.
 */
export function addresses(): Addresses {
  const inline = process.env.ADDRESSES_JSON;
  if (inline) return JSON.parse(inline);
  return JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
}

/** PoolId is keccak256(abi.encode(poolKey)). */
export function poolId(a: Addresses): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [a.pool.currency0, a.pool.currency1, a.pool.fee, a.pool.tickSpacing, a.pool.hook],
    ),
  );
}

export const COUNTRY_NAMES: Record<number, string> = {
  702: "Singapore",
  344: "Hong Kong",
  392: "Japan",
  36: "Australia",
  840: "United States",
};

export const SWAP_ALLOWED = 0x0001;
export const LIQUIDITY_ALLOWED = 0x0002;

export function decodeFlags(flags: Hex) {
  const v = parseInt(flags.slice(2), 16);
  return { swap: (v & SWAP_ALLOWED) !== 0, liquidity: (v & LIQUIDITY_ALLOWED) !== 0, raw: v };
}

/**
 * Pool price expressed as USDC per unit of the permissioned asset.
 *
 * sqrtPriceX96 encodes sqrt(token1/token0) in raw units, so the decimal gap between the
 * 18-decimal asset and the 6-decimal stablecoin has to be undone.
 */
export function priceFromSqrt(sqrtPriceX96: bigint, assetIsCurrency0: boolean): number {
  const q96 = 2 ** 96;
  const sqrt = Number(sqrtPriceX96) / q96;
  const rawRatio = sqrt * sqrt; // token1 per token0, raw units
  // asset 18dp, cash 6dp
  return assetIsCurrency0 ? rawRatio * 1e12 : (1 / rawRatio) * 1e-12;
}

/**
 * Sends a transaction as one of the demo roles.
 *
 * viem's `writeContract` generics do not narrow cleanly against the hand-written `as const`
 * ABIs here (they mix view and nonpayable entries), producing inference errors that say
 * nothing about runtime correctness. Keeping one untyped boundary is preferable to
 * scattering casts across every call site; the contract behaviour itself is covered by the
 * Foundry test suite.
 */
/**
 * Sends a transaction as one of the demo roles, and waits for it to be mined before releasing the
 * signer's queue.
 *
 * Waiting inside the queue is the important part. Submitting concurrently from one signer gives
 * transactions nonces N and N+1; if N is delayed for any reason, N+1 is not merely late but
 * *unmineable*, because the node will not skip a nonce. The gap never closes on its own, so every
 * later transaction from that signer hangs until its caller gives up. Several people signing up
 * at once reproduced this reliably.
 *
 * Strict ordering costs throughput — transactions from one signer are serial — but different
 * signers still proceed in parallel, and correctness here is worth far more than concurrency.
 *
 * Callers that wait for the receipt again get it immediately; that is intentional, so they read
 * naturally without having to know about this.
 */
export async function sendTx(role: RoleName, params: Record<string, unknown>): Promise<Hex> {
  return enqueue(role, async () => {
    const attempt = async (): Promise<Hex> => {
      const w = walletFor(role);
      const hash = (await (w.writeContract as any)({ chain, account: w.account, ...params })) as Hex;
      try {
        await publicClient.waitForTransactionReceipt({ hash, timeout: 25_000 });
      } catch (err) {
        (err as any).stuckTxHash = hash;
        throw err;
      }
      return hash;
    };

    try {
      return await attempt();
    } catch (err) {
      // A receipt timeout here is almost always a transaction sitting above a nonce gap —
      // the signature of stale nonce state after a demo reset (evm_revert). Self-heal: drop
      // the unmineable transaction so it can never fire later out of nowhere, rebuild the
      // signers from the chain's real nonces, and send once more.
      const stuck = (err as any)?.stuckTxHash as Hex | undefined;
      if (!stuck) throw err;
      try {
        // Nuke the whole pool, not just our hash: anvil's per-hash drop skips queued (gapped)
        // transactions — precisely the ones causing this — and every transaction on this demo
        // chain is ours anyway, so anything sitting unmined is garbage by definition.
        await publicClient.request({ method: "anvil_dropAllTransactions" as any, params: [] as any });
      } catch {
        /* not anvil — the retry below still helps */
      }
      resetSigners();
      return await attempt();
    }
  });
}

/** Simulates the same call first, so a compliance rejection surfaces before any gas is spent. */
export async function simulateAs(role: RoleName, params: Record<string, unknown>): Promise<void> {
  const w = walletFor(role);
  await (publicClient.simulateContract as any)({ ...params, account: w.account });
}

export function addressOf(role: RoleName): Address {
  return accountFor(role).address;
}
