"use server";

import { revalidatePath } from "next/cache";
import { encodeFunctionData, formatUnits, type Address } from "viem";
import { addresses, publicClient, sendTx, simulateAs, addressOf, type RoleName } from "@/lib/chain";
import {
  TREX_TOKEN_ABI,
  CHECKER_ABI,
  ADAPTER_ABI,
  ROUTER_ABI,
  ERC20_ABI,
  CUSTODY_ACCOUNT_ABI,
} from "@/lib/abis";
import { buildSwap, explainRevert, type Direction } from "@/lib/swap";

export type ActionResult = { ok: boolean; message: string };

async function run(fn: () => Promise<string>): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath("/");
    return { ok: true, message };
  } catch (err) {
    console.error(err);
    revalidatePath("/");
    return { ok: false, message: explainRevert(err) };
  }
}

// ------------------------------------------------------------------ //
//                        Issuer / agent controls                     //
// ------------------------------------------------------------------ //

export async function freezeWallet(wallet: Address, freeze: boolean): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const hash = await sendTx("agent", {
      address: a.trex.token,
      abi: TREX_TOKEN_ABI,
      functionName: "setAddressFrozen",
      args: [wallet, freeze],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return `${freeze ? "Froze" : "Unfroze"} ${wallet.slice(0, 8)}… in the identity registry.`;
  });
}

export async function setAssetPaused(paused: boolean): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const hash = await sendTx("agent", {
      address: a.trex.token,
      abi: TREX_TOKEN_ABI,
      functionName: paused ? "pause" : "unpause",
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return paused ? "Asset paused. All transfers and trading halted." : "Asset unpaused.";
  });
}

export async function forceTransfer(from: Address, to: Address, amount: string): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const units = BigInt(Math.round(Number(amount) * 10 ** a.trex.decimals));
    const hash = await sendTx("agent", {
      address: a.trex.token,
      abi: TREX_TOKEN_ABI,
      functionName: "forcedTransfer",
      args: [from, to, units],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return `Force-transferred ${amount} units — the recovery path a regulator asks about.`;
  });
}

// ------------------------------------------------------------------ //
//                           Venue controls                           //
// ------------------------------------------------------------------ //

export async function setCountryEnforcement(enforce: boolean): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const hash = await sendTx("issuer", {
      address: a.venue.allowlistChecker,
      abi: CHECKER_ABI,
      functionName: "setCountryEnforcement",
      args: [a.trex.token, enforce],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return enforce
      ? "Venue jurisdiction overlay ON — layered on top of the issuer's own country module."
      : "Venue jurisdiction overlay OFF.";
  });
}

export async function setCountryAllowed(country: number, allowed: boolean): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const hash = await sendTx("issuer", {
      address: a.venue.allowlistChecker,
      abi: CHECKER_ABI,
      functionName: "setCountryAllowed",
      args: [a.trex.token, country, allowed],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return `${allowed ? "Allowed" : "Blocked"} country ${country} at the venue.`;
  });
}

export async function setSwappingEnabled(enabled: boolean): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const hash = await sendTx("issuer", {
      address: a.venue.permissionsAdapter,
      abi: ADAPTER_ABI,
      functionName: "updateSwappingEnabled",
      args: [enabled],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return enabled ? "Trading enabled on the adapter." : "Trading disabled on the adapter.";
  });
}

// ------------------------------------------------------------------ //
//                               Trading                              //
// ------------------------------------------------------------------ //

const DIRECT_ROLES = ["Alice", "Bob", "Carol", "Dave"] as const;

function isDirect(actor: string): actor is RoleName {
  return (DIRECT_ROLES as readonly string[]).includes(actor);
}

/**
 * Executes a swap for any holder, direct or custodied.
 *
 * A direct holder signs for itself. A custody client never signs: the custodian calls
 * `executeOne` on that client's account, and the account is what the router reports as
 * `msgSender()` — so the hook evaluates the *client's* identity, not the custodian's. That
 * is what makes segregated custody work with an issuer-controlled allowlist.
 */
export async function trade(actor: string, direction: Direction, amount: string): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const { unlockData } = buildSwap(a, direction, amount);

    const direct = isDirect(actor);
    const holder: Address = direct ? addressOf(actor as RoleName) : (a.custody as any)[actor];
    if (!holder) throw new Error(`unknown actor ${actor}`);

    const outToken = direction === "buy" ? a.trex.token : a.venue.usdc;
    const outDecimals = direction === "buy" ? a.trex.decimals : 6;
    const balanceOf = async () =>
      (await publicClient.readContract({
        address: outToken,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [holder],
      })) as bigint;

    const before = await balanceOf();

    // A direct holder signs for itself. A custody client never signs: the custodian calls
    // `executeOne` on that client's account, and the account is what the router reports as
    // `msgSender()`, so the hook evaluates the *client's* identity rather than the
    // custodian's. That is what lets segregated custody work under an issuer-held allowlist.
    const call = direct
      ? {
          address: a.venue.router,
          abi: ROUTER_ABI,
          functionName: "execute",
          args: [unlockData, deadline],
        }
      : {
          address: holder,
          abi: CUSTODY_ACCOUNT_ABI,
          functionName: "executeOne",
          args: [
            a.venue.router,
            0n,
            encodeFunctionData({ abi: ROUTER_ABI, functionName: "execute", args: [unlockData, deadline] }),
          ],
        };

    const signer: RoleName = direct ? (actor as RoleName) : "custodian";
    await simulateAs(signer, call);
    const hash = await sendTx(signer, call);

    await publicClient.waitForTransactionReceipt({ hash });

    const received = formatUnits((await balanceOf()) - before, outDecimals);
    const inSymbol = direction === "buy" ? "USDC" : a.trex.tokenSymbol;
    const outSymbol = direction === "buy" ? a.trex.tokenSymbol : "USDC";
    const via = direct ? "" : ` (via ${a.custody.custodianName})`;
    return `${actor}${via} swapped ${amount} ${inSymbol} \u2192 ${received} ${outSymbol}.`;
  });
}
