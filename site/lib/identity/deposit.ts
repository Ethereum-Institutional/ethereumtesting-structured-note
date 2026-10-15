import "server-only";
import { randomBytes } from "node:crypto";
import { keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { context } from "./onchain.ts";

/**
 * The bank's credits of its tokenized deposit (ADR 0086): through the deposit gateway, each against
 * a single-use booking reference the site assigns.
 */

const GATEWAY = parseAbi(["function credit(address account, uint256 amount, bytes32 bookingRef)"]);
const TOKEN = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export function depositToken(): { address: Address; symbol: string; decimals: number } {
  const { m } = context();
  const t = m.assets.deposit;
  if (!t) throw new Error("the manifest has no deposit");
  return t;
}

export async function creditDeposit(account: Address, amount: bigint): Promise<{ tx: Hex; bookingRef: string }> {
  const { m, s } = context();
  if (amount <= 0n) throw new Error("the amount must be more than zero");
  const bookingRef = `BKG-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
  const tx = await s.send("depositAgent", { address: m.instruments!.gateway, abi: GATEWAY, functionName: "credit", args: [account, amount, keccak256(toBytes(bookingRef))] });
  return { tx, bookingRef };
}

export function depositBalance(account: Address): Promise<bigint> {
  const { s } = context();
  return s.publicClient.readContract({ address: depositToken().address, abi: TOKEN, functionName: "balanceOf", args: [account] });
}
