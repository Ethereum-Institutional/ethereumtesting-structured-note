import "server-only";
import { randomBytes } from "node:crypto";
import { createPublicClient, defineChain, encodeAbiParameters, encodeFunctionData, http, keccak256, maxUint160, maxUint256, parseAbi, parseAbiParameters, toBytes, type Address, type Hex } from "viem";
import { loadManifest, poolId, poolKey, type Manifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";
import { minimumReceived, quoteExactIn, type PoolState } from "./quote.ts";

/**
 * Conversion in the pool: quotes from the pool's own state, the swap plan the venue
 * expects (swap exact-in, settle all, take all, through the permissioned router), the one-time
 * Permit2 approvals a self-custody wallet signs, the custodian's conversion for a custody account,
 * and the bank's credit of the deposit.
 */

export type Direction = "into-deposit" | "into-payment";
const DEADLINE_SECONDS = 600;
const APPROVAL_DAYS = 30;

const STATE_VIEW = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);
const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const PERMIT2 = parseAbi([
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);
const ROUTER = parseAbi(["function execute(bytes unlockData, uint256 deadline) payable"]);
const ACCOUNT = parseAbi(["function execute((address target, uint256 value, bytes data)[] calls) returns (bytes[])"]);
const GATEWAY = parseAbi(["function credit(address account, uint256 amount, bytes32 bookingRef)"]);

// v4-periphery Actions.
const SWAP_EXACT_IN_SINGLE = 0x06;
const SETTLE_ALL = 0x0c;
const TAKE_ALL = 0x0f;

/** Whether this deployment has the conversion pool: by default it does. */
export function hasPool(m: Manifest = loadManifest()): boolean {
  return Boolean(m.venue && m.pool);
}

type PoolManifest = Manifest & { venue: NonNullable<Manifest["venue"]>; pool: NonNullable<Manifest["pool"]> };

/** The manifest, where it has the pool; refused otherwise, in words. */
function poolManifest(loaded: Manifest = loadManifest()): PoolManifest {
  if (!loaded.venue || !loaded.pool) throw new Error("This deployment has no conversion pool: it was deployed with POOL=0.");
  return loaded as PoolManifest;
}

function context() {
  const m = poolManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, chain, rpc, client: createPublicClient({ chain, transport: http(rpc) }) };
}

/** The two tokens, as the client sees them; the pool's second currency is the deposit's adapter. */
export function tokens(m: Manifest = loadManifest()) {
  const payment = { address: m.assets.paymentToken!.address as Address, symbol: m.assets.paymentToken!.symbol, decimals: m.assets.paymentToken!.decimals };
  const deposit = { address: m.assets.deposit!.address as Address, symbol: m.assets.deposit!.symbol, decimals: m.assets.deposit!.decimals };
  return { payment, deposit };
}

async function poolState(): Promise<PoolState> {
  const { m, client } = context();
  if (!m.lens?.stateView) throw new Error("the deployment has no state lens");
  const id = poolId(poolKey(m.pool));
  const [slot0, liquidity] = await Promise.all([
    client.readContract({ address: m.lens.stateView, abi: STATE_VIEW, functionName: "getSlot0", args: [id] }),
    client.readContract({ address: m.lens.stateView, abi: STATE_VIEW, functionName: "getLiquidity", args: [id] }),
  ]);
  return { sqrtPriceX96: slot0[0], liquidity, tickLower: m.pool.tickLower, tickUpper: m.pool.tickUpper, fee: m.pool.fee };
}

/** Which way a direction swaps in the pool: the payment token is paid in directly, the deposit through its adapter. */
function sides(direction: Direction, m: PoolManifest) {
  const t = tokens(m);
  const paidCurrency = direction === "into-deposit" ? t.payment.address : m.venue.permissionsAdapter;
  const zeroForOne = m.pool.currency0.toLowerCase() === paidCurrency.toLowerCase();
  return { zeroForOne, paid: direction === "into-deposit" ? t.payment : t.deposit, received: direction === "into-deposit" ? t.deposit : t.payment };
}

export type Quote = { amountIn: bigint; amountOut: bigint; minimumOut: bigint; paid: string; received: string; paidDecimals: number; receivedDecimals: number };

export async function quote(direction: Direction, amountIn: bigint): Promise<Quote> {
  const m = poolManifest();
  const s = sides(direction, m);
  const out = quoteExactIn(await poolState(), amountIn, s.zeroForOne);
  if (out <= 0n) throw new Error("that amount is too small to convert");
  return { amountIn, amountOut: out, minimumOut: minimumReceived(out), paid: s.paid.symbol, received: s.received.symbol, paidDecimals: s.paid.decimals, receivedDecimals: s.received.decimals };
}

/** The router call for one conversion: swap exact-in, settle what is owed, take what is due, at least `minimumOut`. */
export function swapCall(direction: Direction, amountIn: bigint, minimumOut: bigint, nowSec: number, m: PoolManifest = poolManifest()): { to: Address; data: Hex } {
  const s = sides(direction, m);
  const key = poolKey(m.pool);
  const [inCurrency, outCurrency] = s.zeroForOne ? [key.currency0, key.currency1] : [key.currency1, key.currency0];
  const actions = `0x${[SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL].map((a) => a.toString(16).padStart(2, "0")).join("")}` as Hex;
  const swap = encodeAbiParameters(
    parseAbiParameters("((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, uint256 minHopPriceX36, bytes hookData)"),
    [{ poolKey: key, zeroForOne: s.zeroForOne, amountIn, amountOutMinimum: minimumOut, minHopPriceX36: 0n, hookData: "0x" }],
  );
  const settle = encodeAbiParameters(parseAbiParameters("address, uint256"), [inCurrency, amountIn]);
  const take = encodeAbiParameters(parseAbiParameters("address, uint256"), [outCurrency, minimumOut]);
  const unlockData = encodeAbiParameters(parseAbiParameters("bytes, bytes[]"), [actions, [swap, settle, take]]);
  return { to: m.venue.router, data: encodeFunctionData({ abi: ROUTER, functionName: "execute", args: [unlockData, BigInt(nowSec + DEADLINE_SECONDS)] }) };
}

/**
 * Now, by the chain's clock where it runs ahead of this server's, as a local chain moved forward
 * does: a deadline or an allowance's expiry is checked against the block, not the wall.
 */
export async function chainNow(): Promise<number> {
  const { client } = context();
  const block = await client.getBlock();
  return Math.max(Number(block.timestamp), Math.floor(Date.now() / 1000));
}

export type WalletView = { eth: bigint; payment: bigint; deposit: bigint };

export async function balances(owner: Address): Promise<WalletView> {
  const { client } = context();
  const t = tokens();
  const [eth, payment, deposit] = await Promise.all([
    client.getBalance({ address: owner }),
    client.readContract({ address: t.payment.address, abi: ERC20, functionName: "balanceOf", args: [owner] }),
    client.readContract({ address: t.deposit.address, abi: ERC20, functionName: "balanceOf", args: [owner] }),
  ]);
  return { eth, payment, deposit };
}

export type TxRequest = { to: Address; data: Hex; label: string };

/**
 * What a self-custody wallet must send before converting `amountIn`: the token's
 * approval to Permit2 if missing, and Permit2's allowance to the router if short or lapsing, for 30
 * days. Once set, each conversion is the swap alone.
 */
export async function approvalsNeeded(owner: Address, direction: Direction, amountIn: bigint, nowSec: number): Promise<TxRequest[]> {
  const { m, client } = context();
  const token = sides(direction, m).paid;
  const out: TxRequest[] = [];
  const toPermit2 = await client.readContract({ address: token.address, abi: ERC20, functionName: "allowance", args: [owner, m.venue.permit2] });
  if (toPermit2 < amountIn) {
    out.push({ to: token.address, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [m.venue.permit2, maxUint256] }), label: `Allow Permit2 to move your ${token.symbol}` });
  }
  const [amount, expiration] = await client.readContract({ address: m.venue.permit2, abi: PERMIT2, functionName: "allowance", args: [owner, token.address, m.venue.router] });
  if (amount < amountIn || Number(expiration) < nowSec + 3600) {
    out.push({
      to: m.venue.permit2,
      data: encodeFunctionData({ abi: PERMIT2, functionName: "approve", args: [token.address, m.venue.router, maxUint160, nowSec + APPROVAL_DAYS * 86_400] }),
      label: `Allow the pool's router to draw your ${token.symbol}, for ${APPROVAL_DAYS} days`,
    });
  }
  return out;
}

/**
 * A custody account converts: the custodian's key calls the router through the account, in one
 * batch with whichever Permit2 approvals the account still lacks.
 */
export async function convertForCustody(account: Address, direction: Direction, amountIn: bigint): Promise<{ tx: Hex; quote: Quote }> {
  const { chain, rpc } = context();
  const q = await quote(direction, amountIn);
  // Read again for a few seconds before concluding the balance is short: just after a credit, a
  // load-balanced RPC may still answer from the block before it ('s lagging node).
  let held = 0n;
  for (let tries = 0; tries < 8; tries++) {
    const have = await balances(account);
    held = direction === "into-deposit" ? have.payment : have.deposit;
    if (held >= amountIn) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (held < amountIn) throw new Error(`the custody account holds ${held} and cannot convert ${amountIn}`);
  const nowSec = await chainNow();
  const calls = [...(await approvalsNeeded(account, direction, amountIn, nowSec)), swapCall(direction, amountIn, q.minimumOut, nowSec)];
  const s = signers(chain, rpc);
  const tx = await s.send("custodian", { address: account, abi: ACCOUNT, functionName: "execute", args: [calls.map((c) => ({ target: c.to, value: 0n, data: c.data }))] });
  return { tx, quote: q };
}

/** The bank credits the deposit to an account: the Deposit Agent through the gateway, against a single-use booking reference. */
