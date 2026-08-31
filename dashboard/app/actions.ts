"use server";

import { revalidatePath } from "next/cache";
import {
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  keccak256,
  parseUnits,
  toHex,
  type Address,
} from "viem";
import {
  addresses,
  publicClient,
  sendTx,
  simulateAs,
  addressOf,
  walletFor,
  poolId,
  priceFromSqrt,
  resetSigners,
  COUNTRY_NAMES,
  type RoleName,
} from "@/lib/chain";
import { recordOrder, clearOrders } from "@/lib/orders";
import { plainGate } from "@/lib/gates";
import { applicantStatus } from "@/lib/applications";
import {
  TREX_TOKEN_ABI,
  CHECKER_ABI,
  ADAPTER_ABI,
  ROUTER_ABI,
  ERC20_ABI,
  CUSTODY_ACCOUNT_ABI,
  ID_FACTORY_ABI,
  IDENTITY_ABI,
  IDENTITY_REGISTRY_WRITE_ABI,
  TREX_MINT_ABI,
  MODULAR_COMPLIANCE_ABI,
  MAX_BALANCE_MODULE_ABI,
  DEMO_BASELINE_ABI,
  STATE_VIEW_ABI,
} from "@/lib/abis";
import { buildSwap, explainRevert, type Direction } from "@/lib/swap";
import { requireAdmin } from "@/lib/auth";

/**
 * The on-chain half of an action's outcome: which contract was called, the exact Solidity call,
 * the mined transaction, and — where it makes the point — the changed state read back from the
 * chain afterwards. Rendered by the Result component so every control shows what it really did.
 */
export type ChainReceipt = {
  contract: string;
  address: string;
  fn: string;
  args: string[];
  txHash?: string;
  block?: number;
  readback?: string;
};

export type ActionResult = { ok: boolean; message: string; chain?: ChainReceipt };

/**
 * Every action in this file is a privileged custody or issuer operation — trading on a client's
 * behalf, freezing a wallet, force-transferring a holding, pausing the asset, resetting the
 * chain. So the authorisation check lives in the wrapper they all share rather than in each one:
 * a check that has to be remembered eleven times is a check that will eventually be forgotten,
 * and the consequence here is an anonymous caller moving somebody else's money.
 *
 * This is the real control. Hiding the page is not one: server actions are reachable endpoints
 * whether or not a UI renders a button for them.
 */
async function run(
  fn: () => Promise<string | { message: string; chain?: ChainReceipt }>,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, message: "Sign in as compliance staff to do that." };
  }
  try {
    const r = await fn();
    // "layout" scope: the console is several pages now, and an action taken on one (a freeze on
    // /investors) must refresh the others' data (the tape on /, the badges in the shell).
    revalidatePath("/", "layout");
    return typeof r === "string" ? { ok: true, message: r } : { ok: true, ...r };
  } catch (err) {
    console.error(err);
    revalidatePath("/", "layout");
    // Errors thrown with `plain` set already carry a human sentence; running those through the
    // revert decoder would degrade them back into "Reverted (see server log)".
    const message = (err as any)?.plain ? String((err as any).message) : explainRevert(err);
    return { ok: false, message };
  }
}

/** Builds the on-chain receipt for a mined transaction, with an optional state read-back. */
async function receipt(
  hash: `0x${string}`,
  contract: string,
  address: Address,
  fn: string,
  args: string[],
  readback?: () => Promise<string>,
): Promise<ChainReceipt> {
  const r = await publicClient.waitForTransactionReceipt({ hash });
  return {
    contract,
    address,
    fn,
    args,
    txHash: hash,
    block: Number(r.blockNumber),
    readback: readback ? await readback().catch(() => undefined) : undefined,
  };
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
    const chain = await receipt(
      hash,
      `${a.trex.tokenSymbol} token (ERC-3643)`,
      a.trex.token,
      "setAddressFrozen",
      [`${wallet.slice(0, 8)}…`, String(freeze)],
      async () => {
        const v = await publicClient.readContract({
          address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "isFrozen", args: [wallet],
        });
        return `isFrozen(${wallet.slice(0, 8)}…) → ${v}`;
      },
    );
    return { message: `${freeze ? "Froze" : "Unfroze"} ${wallet.slice(0, 8)}… on the token itself.`, chain };
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
    const chain = await receipt(
      hash,
      `${a.trex.tokenSymbol} token (ERC-3643)`,
      a.trex.token,
      paused ? "pause" : "unpause",
      [],
      async () => {
        const v = await publicClient.readContract({
          address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "paused",
        });
        return `paused() → ${v}`;
      },
    );
    return {
      message: paused ? "Asset paused. All transfers and trading halted." : "Asset unpaused.",
      chain,
    };
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
    const chain = await receipt(
      hash,
      "Compliance bridge (ERC3643AllowlistChecker)",
      a.venue.allowlistChecker,
      "setCountryEnforcement",
      [a.trex.tokenSymbol, String(enforce)],
      async () => {
        const policy = (await publicClient.readContract({
          address: a.venue.allowlistChecker, abi: CHECKER_ABI, functionName: "policyOf", args: [a.trex.token],
        })) as any;
        return `policyOf(${a.trex.tokenSymbol}).enforceCountries → ${policy[3]}`;
      },
    );
    return {
      message: enforce
        ? "Venue jurisdiction overlay ON — layered on top of the issuer's own country module."
        : "Venue jurisdiction overlay OFF.",
      chain,
    };
  });
}

export async function setCountryAllowed(country: number, allowed: boolean): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const countryName = COUNTRY_NAMES[country] ?? String(country);

    // Blocking a country while the overlay is off would change a flag the contract ignores —
    // the investor keeps trading and the demo looks broken. Nobody blocks a jurisdiction
    // without meaning it, so switch enforcement on as part of the same action.
    let enforcementNote = "";
    if (!allowed) {
      const policy = (await publicClient.readContract({
        address: a.venue.allowlistChecker, abi: CHECKER_ABI, functionName: "policyOf", args: [a.trex.token],
      })) as any;
      if (!policy[3]) {
        const eh = await sendTx("issuer", {
          address: a.venue.allowlistChecker,
          abi: CHECKER_ABI,
          functionName: "setCountryEnforcement",
          args: [a.trex.token, true],
        });
        await publicClient.waitForTransactionReceipt({ hash: eh });
        enforcementNote = " The jurisdiction overlay was off, so it was switched ON in the same action (setCountryEnforcement).";
      }
    }

    const hash = await sendTx("issuer", {
      address: a.venue.allowlistChecker,
      abi: CHECKER_ABI,
      functionName: "setCountryAllowed",
      args: [a.trex.token, country, allowed],
    });
    const chain = await receipt(
      hash,
      "Compliance bridge (ERC3643AllowlistChecker)",
      a.venue.allowlistChecker,
      "setCountryAllowed",
      [a.trex.tokenSymbol, `${country} /* ${countryName} */`, String(allowed)],
      async () => {
        const v = await publicClient.readContract({
          address: a.venue.allowlistChecker, abi: CHECKER_ABI, functionName: "isCountryAllowed",
          args: [a.trex.token, country],
        });
        return `isCountryAllowed(${a.trex.tokenSymbol}, ${country}) → ${v}`;
      },
    );
    return {
      message: `${allowed ? "Allowed" : "Blocked"} ${countryName} at the venue.${enforcementNote} Every trade from a ${countryName}-registered passport now ${allowed ? "passes" : "fails"} this gate.`,
      chain,
    };
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
    const chain = await receipt(
      hash,
      "Permissions adapter (Uniswap v4)",
      a.venue.permissionsAdapter,
      "updateSwappingEnabled",
      [String(enabled)],
      async () => {
        const v = await publicClient.readContract({
          address: a.venue.permissionsAdapter, abi: ADAPTER_ABI, functionName: "swappingEnabled",
        });
        return `swappingEnabled() → ${v}`;
      },
    );
    return {
      message: enabled ? "Trading enabled on the adapter." : "Trading disabled on the adapter.",
      chain,
    };
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

    // Display name for the trade tape: custody clients trade under a ref like "CLIENT-A".
    const who =
      [...(a.custodyClients ?? []), ...(a.custodyPending ?? [])].find((c) => c.ref === actor)?.name ?? actor;
    const inSymbol = direction === "buy" ? "USDC" : a.trex.tokenSymbol;
    const outSymbol = direction === "buy" ? a.trex.tokenSymbol : "USDC";

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
    let hash: `0x${string}`;
    try {
      await simulateAs(signer, call);
      hash = await sendTx(signer, call);
    } catch (err) {
      // The hook refused it in simulation \u2014 nothing was mined. Name the gate, in plain English,
      // and put the rejection on the trade tape where the audience can see it.
      let reason = explainRevert(err);
      try {
        const st = await applicantStatus(holder);
        if (st.gate !== "clear") reason = plainGate(st.gate);
      } catch {
        /* keep the decoded revert */
      }
      await recordOrder({ who, direction, amountIn: amount, inSymbol, outSymbol, ok: false, reason });
      throw Object.assign(new Error(`Rejected by the compliance hook: ${reason}.`), { plain: true });
    }

    await publicClient.waitForTransactionReceipt({ hash });

    const received = formatUnits((await balanceOf()) - before, outDecimals);
    await recordOrder({ who, direction, amountIn: amount, inSymbol, outSymbol, ok: true, received, txHash: hash });

    const chain = await receipt(
      hash,
      "Permissioned router (Uniswap v4)",
      a.venue.router,
      "execute",
      ["\u00abencoded swap plan\u00bb", "deadline"],
      async () => {
        const slot0 = (await publicClient.readContract({
          address: a.lens.stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [poolId(a)],
        })) as any;
        const assetIs0 = a.pool.currency0.toLowerCase() === a.venue.permissionsAdapter.toLowerCase();
        return `pool price after settlement \u2192 ${priceFromSqrt(slot0[0], assetIs0).toFixed(4)} USDC/${a.trex.tokenSymbol}`;
      },
    );

    const via = direct ? "" : ` (via ${a.custody.custodianName})`;
    return { message: `${who}${via} swapped ${amount} ${inSymbol} \u2192 ${received} ${outSymbol}.`, chain };
  });
}

// ------------------------------------------------------------------ //
//                       Asset servicing operations                   //
// ------------------------------------------------------------------ //

/**
 * Issues new units to a verified holder — a subscription, in fund terms.
 *
 * The token's own compliance decides whether the mint is allowed: minting to an unverified
 * wallet reverts on-chain, which is the right place for that check to live.
 */
export async function mintUnits(wallet: Address, amount: string): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const units = parseUnits(amount || "0", a.trex.decimals);
    if (units === 0n) throw new Error("Enter an amount greater than zero.");
    const hash = await sendTx("agent", {
      address: a.trex.token, abi: TREX_MINT_ABI, functionName: "mint", args: [wallet, units],
    });
    const chain = await receipt(
      hash, `${a.trex.tokenSymbol} token (ERC-3643)`, a.trex.token, "mint",
      [`${wallet.slice(0, 8)}…`, amount],
      async () => {
        const supply = await publicClient.readContract({
          address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "totalSupply",
        });
        return `totalSupply() → ${formatUnits(supply as bigint, a.trex.decimals)}`;
      },
    );
    return { message: `Issued ${amount} ${a.trex.tokenSymbol} to ${wallet.slice(0, 8)}….`, chain };
  });
}

/** Burns units from a holder — a redemption. Agent-only on the token itself. */
export async function burnUnits(wallet: Address, amount: string): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const units = parseUnits(amount || "0", a.trex.decimals);
    if (units === 0n) throw new Error("Enter an amount greater than zero.");
    const hash = await sendTx("agent", {
      address: a.trex.token, abi: TREX_MINT_ABI, functionName: "burn", args: [wallet, units],
    });
    const chain = await receipt(
      hash, `${a.trex.tokenSymbol} token (ERC-3643)`, a.trex.token, "burn",
      [`${wallet.slice(0, 8)}…`, amount],
      async () => {
        const supply = await publicClient.readContract({
          address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "totalSupply",
        });
        return `totalSupply() → ${formatUnits(supply as bigint, a.trex.decimals)}`;
      },
    );
    return { message: `Redeemed ${amount} ${a.trex.tokenSymbol} from ${wallet.slice(0, 8)}….`, chain };
  });
}

/**
 * Partially freezes a holder's balance.
 *
 * Distinct from a wallet freeze: the holder keeps trading, but the frozen portion cannot move.
 * The token itself rejects any transfer that would dip into it. This is the tool a transfer
 * agent reaches for far more often than a full freeze -- a pledged position, a disputed
 * subscription, a court order over part of a holding.
 */
export async function setPartialFreeze(wallet: Address, amount: string, freeze: boolean): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const units = parseUnits(amount || "0", a.trex.decimals);
    if (units === 0n) throw new Error("Amount must be greater than zero.");
    const hash = await sendTx("agent", {
      address: a.trex.token,
      abi: TREX_TOKEN_ABI,
      functionName: freeze ? "freezePartialTokens" : "unfreezePartialTokens",
      args: [wallet, units],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return `${freeze ? "Froze" : "Released"} ${amount} units for ${wallet.slice(0, 8)}… — the rest of the balance still trades.`;
  });
}

/**
 * Completes KYC for a custody client that was deployed but never onboarded.
 *
 * The whole onboarding, live: mint the account an ONCHAINID (with the issuer as management key,
 * since a contract cannot sign for itself), have the trusted claim issuer attest KYC on it,
 * register it in the identity registry under a jurisdiction, and allocate it a holding.
 *
 * This is the same sequence trex/scripts/onboard-custody.ts runs at deploy time. Doing it from
 * the console turns "this client is blocked" from a static fact into something the audience
 * watches change.
 */
export async function completeKyc(clientRef: string, country: number, allocation: string): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const account = (a.custody as any)[clientRef] as Address;
    if (!account) throw new Error(`Unknown client ${clientRef}`);

    const issuer = addressOf("issuer");
    const alreadyRegistered = (await publicClient.readContract({
      address: a.trex.identityRegistry,
      abi: IDENTITY_REGISTRY_WRITE_ABI,
      functionName: "contains",
      args: [account],
    })) as boolean;
    if (alreadyRegistered) throw new Error(`${clientRef} is already registered.`);

    // 1. Identity, with the issuer holding the management key.
    let identity = (await publicClient.readContract({
      address: a.trex.idFactory,
      abi: ID_FACTORY_ABI,
      functionName: "getIdentity",
      args: [account],
    })) as Address;

    if (identity === "0x0000000000000000000000000000000000000000") {
      const managementKey = keccak256(encodeAbiParameters([{ type: "address" }], [issuer]));
      const h = await sendTx("issuer", {
        address: a.trex.idFactory,
        abi: ID_FACTORY_ABI,
        functionName: "createIdentityWithManagementKeys",
        args: [account, `live-kyc-${clientRef.toLowerCase()}`, [managementKey]],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      identity = (await publicClient.readContract({
        address: a.trex.idFactory,
        abi: ID_FACTORY_ABI,
        functionName: "getIdentity",
        args: [account],
      })) as Address;
    }

    // 2. KYC claim, signed by the trusted issuer's claim key.
    const existing = (await publicClient.readContract({
      address: identity,
      abi: IDENTITY_ABI,
      functionName: "getClaimIdsByTopic",
      args: [BigInt(a.topics.KYC)],
    })) as readonly `0x${string}`[];

    if (existing.length === 0) {
      const data = toHex(`KYC verified live: ${clientRef} (via ${a.custody.custodianName})`);
      // ClaimIssuer.isClaimValid expects an EIP-191 personal-sign over
      // keccak256(abi.encode(identity, topic, data)).
      const digest = keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }, { type: "bytes" }],
          [identity, BigInt(a.topics.KYC), data],
        ),
      );
      const claimSigner = walletFor("claimSigner");
      const signature = await claimSigner.signMessage({
        account: claimSigner.account,
        message: { raw: digest },
      });

      const h = await sendTx("issuer", {
        address: identity,
        abi: IDENTITY_ABI,
        functionName: "addClaim",
        args: [BigInt(a.topics.KYC), 1n, a.trex.claimIssuer, signature, data, ""],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    // 3. Register as a holder of record.
    const h2 = await sendTx("agent", {
      address: a.trex.identityRegistry,
      abi: IDENTITY_REGISTRY_WRITE_ABI,
      functionName: "registerIdentity",
      args: [account, identity, country],
    });
    await publicClient.waitForTransactionReceipt({ hash: h2 });

    const verified = (await publicClient.readContract({
      address: a.trex.identityRegistry,
      abi: IDENTITY_REGISTRY_WRITE_ABI,
      functionName: "isVerified",
      args: [account],
    })) as boolean;
    if (!verified) throw new Error("Registered, but isVerified() is still false — check the claim topics.");

    // 4. Allocate a holding so the client can be seen trading.
    if (allocation && Number(allocation) > 0) {
      const h3 = await sendTx("agent", {
        address: a.trex.token,
        abi: TREX_MINT_ABI,
        functionName: "mint",
        args: [account, parseUnits(allocation, a.trex.decimals)],
      });
      await publicClient.waitForTransactionReceipt({ hash: h3 });
    }

    // Only KYC is attested here, so the venue's professional-investor requirement for
    // liquidity provision is still unmet -- the client can swap but not LP. Worth saying out
    // loud during the demo, since it shows the two permissions are genuinely independent.
    return `${clientRef} onboarded: identity ${identity.slice(0, 8)}…, KYC attested by the trusted issuer, registered, ${allocation || "0"} units allocated. It can swap now — but not provide liquidity, which needs the professional-investor claim.`;
  });
}

/**
 * Binds or unbinds the per-investor maximum balance compliance module.
 *
 * Shows that compliance is modular and changeable at runtime: the issuer adds a concentration
 * limit and it takes effect on the next transfer, with no redeployment and no venue involvement.
 */
export async function setMaxBalanceModule(bind: boolean, maxUnits: string): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const module = a.trex.modules.maxBalance;
    const compliance = a.trex.modularCompliance;

    const bound = (await publicClient.readContract({
      address: compliance,
      abi: MODULAR_COMPLIANCE_ABI,
      functionName: "isModuleBound",
      args: [module],
    })) as boolean;

    if (!bind) {
      if (!bound) throw new Error("The max-balance module is not bound.");
      const h = await sendTx("issuer", {
        address: compliance,
        abi: MODULAR_COMPLIANCE_ABI,
        functionName: "removeModule",
        args: [module],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      return "Max-balance limit removed from compliance.";
    }

    if (!bound) {
      const h = await sendTx("issuer", {
        address: compliance,
        abi: MODULAR_COMPLIANCE_ABI,
        functionName: "addModule",
        args: [module],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    // Module configuration must be routed through the compliance contract.
    const callData = encodeFunctionData({
      abi: MAX_BALANCE_MODULE_ABI,
      functionName: "setMaxBalance",
      args: [parseUnits(maxUnits || "0", a.trex.decimals)],
    });
    const h2 = await sendTx("issuer", {
      address: compliance,
      abi: MODULAR_COMPLIANCE_ABI,
      functionName: "callModuleFunction",
      args: [callData, module],
    });
    await publicClient.waitForTransactionReceipt({ hash: h2 });

    return `Concentration limit set: no holder may exceed ${maxUnits} units. Effective on the next transfer.`;
  });
}

// ------------------------------------------------------------------ //
//                              Demo reset                            //
// ------------------------------------------------------------------ //

/**
 * Returns the chain to its armed baseline.
 *
 * Anvil consumes a snapshot when it is reverted and never reissues the id, so the baseline has
 * to be re-armed every time. The id lives in {DemoBaseline} because the console keeps no state
 * of its own between requests.
 *
 * A stale or missing id is expected rather than an error -- snapshots do not survive the state
 * dump a hosted chain boots from -- so the first press on a fresh chain arms a baseline instead
 * of reverting to one.
 */
export async function resetDemo(): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const baseline = a.ops?.demoBaseline as Address;
    if (!baseline) throw new Error("No DemoBaseline deployed — run script/05_DeployOps.s.sol.");

    const arm = async (): Promise<bigint> => {
      const id = (await publicClient.request({ method: "evm_snapshot" as any, params: [] as any })) as `0x${string}`;
      const h = await sendTx("issuer", {
        address: baseline,
        abi: DEMO_BASELINE_ABI,
        functionName: "arm",
        args: [BigInt(id), BigInt(Math.floor(Date.now() / 1000))],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      return BigInt(id);
    };

    // Read the flag, not the id: snapshot 0x0 is a perfectly valid baseline.
    const [isArmed, stored] = (await Promise.all([
      publicClient.readContract({ address: baseline, abi: DEMO_BASELINE_ABI, functionName: "isArmed" }),
      publicClient.readContract({ address: baseline, abi: DEMO_BASELINE_ABI, functionName: "snapshotId" }),
    ])) as [boolean, bigint];

    if (!isArmed) {
      const id = await arm();
      return `Baseline captured at the current state (snapshot ${id}). Press reset again to return here.`;
    }

    const reverted = (await publicClient.request({
      method: "evm_revert" as any,
      params: [`0x${stored.toString(16)}`] as any,
    })) as boolean;

    // The revert rolled every account's nonce back; cached nonce state is now poison. Discard
    // it before the very next transaction (the re-arm below), or that transaction sits above
    // a nonce gap forever and the reset appears to hang.
    resetSigners();

    if (!reverted) {
      const id = await arm();
      return `The previous baseline had expired, so a new one was captured at the current state (snapshot ${id}).`;
    }

    await arm();
    await clearOrders(); // the rewind orphans every recorded order
    return "Demo reset. Balances, freezes, pauses and the pool price are back to the baseline.";
  });
}

// ------------------------------------------------------------------ //
//                          Pool administration                       //
// ------------------------------------------------------------------ //

/**
 * Deploys treasury inventory into the pool as standing liquidity.
 *
 * The custodian executes it through the treasury's custody account, so the hook checks the
 * treasury's own LIQUIDITY_ALLOWED permission — the fund is subject to the same gate as any LP.
 * Cash is topped up first if the treasury holds less than the plan needs, since the treasury's
 * inventory is units, not stablecoin.
 */
export async function addTreasuryLiquidity(assetUnits: string, cashUsdc: string): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    if (!a.treasury?.account) throw new Error("No treasury account is configured.");
    const { buildMintLiquidityPlan } = await import("@/lib/pool");
    const { POSM_ABI, DEMO_USDC_ABI, CUSTODY_ACCOUNT_ABI } = await import("@/lib/abis");
    const { encodeFunctionData, parseUnits: pu, formatUnits: fu } = await import("viem");

    const units = Number(String(assetUnits).replace(/[, _]/g, ""));
    const cash = Number(String(cashUsdc).replace(/[, _]/g, ""));
    if (!Number.isFinite(units) || units <= 0 || !Number.isFinite(cash) || cash <= 0) {
      throw new Error("Enter the units and cash to deploy, both greater than zero.");
    }

    const treasury = a.treasury.account as `0x${string}`;
    const held = (await publicClient.readContract({
      address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "balanceOf", args: [treasury],
    })) as bigint;
    if (held < pu(String(units), a.trex.decimals)) {
      throw new Error(`Treasury holds ${fu(held, a.trex.decimals)} units — not enough to deploy ${units.toLocaleString()}.`);
    }

    // The treasury's inventory is the asset; settlement cash for the other leg is issued to it.
    const cashHeld = (await publicClient.readContract({
      address: a.venue.usdc, abi: DEMO_USDC_ABI, functionName: "balanceOf", args: [treasury],
    })) as bigint;
    const cashNeeded = pu(String(cash), 6);
    if (cashHeld < cashNeeded) {
      const h = await sendTx("issuer", {
        address: a.venue.usdc, abi: DEMO_USDC_ABI, functionName: "mint", args: [treasury, cashNeeded - cashHeld],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    const { unlockData, liquidity } = buildMintLiquidityPlan(a, units, cash);
    const hash = await sendTx("custodian", {
      address: treasury,
      abi: CUSTODY_ACCOUNT_ABI,
      functionName: "executeOne",
      args: [
        a.venue.positionManager,
        0n,
        encodeFunctionData({
          abi: POSM_ABI,
          functionName: "modifyLiquidities",
          args: [unlockData, BigInt(Math.floor(Date.now() / 1000) + 600)],
        }),
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const tokenId = ((await publicClient.readContract({
      address: a.venue.positionManager, abi: POSM_ABI, functionName: "nextTokenId",
    })) as bigint) - 1n;

    return `Deployed up to ${units.toLocaleString()} units and ${cash.toLocaleString()} USDC as position #${tokenId} (liquidity ${liquidity}). The position NFT is non-transferable and owned by the treasury.`;
  });
}

/**
 * Force-exits a liquidity provider.
 *
 * This is Uniswap's own admin control on permissioned pools: the adapter's owner can unwind any
 * position, burning the NFT and returning both legs to the LP. It exists for exactly the case a
 * regulator asks about — an LP whose permission has been revoked cannot be left earning fees in
 * the pool. Position NFTs being non-transferable closes the other escape route.
 */
export async function unwindLpPosition(tokenId: string): Promise<ActionResult> {
  return run(async () => {
    const a = addresses();
    const { POSM_ABI } = await import("@/lib/abis");
    const id = BigInt(Number(tokenId));
    if (id <= 0n) throw new Error("Enter a position id.");

    const owner = (await publicClient.readContract({
      address: a.venue.positionManager, abi: POSM_ABI, functionName: "ownerOf", args: [id],
    }).catch(() => null)) as `0x${string}` | null;
    if (!owner) throw new Error(`Position #${tokenId} does not exist (already unwound?).`);

    const hash = await sendTx("issuer", {
      address: a.venue.positionManager,
      abi: POSM_ABI,
      functionName: "unwindPosition",
      args: [id, 0n, 0n, "0x"],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return `Position #${tokenId} unwound. Both legs were returned to ${owner.slice(0, 8)}… and the position NFT was burned.`;
  });
}
