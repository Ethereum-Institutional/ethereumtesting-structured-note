"use server";

import {
  encodeAbiParameters,
  keccak256,
  hashMessage,
  recoverAddress,
  hexToString,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { publicClient, addresses, COUNTRY_NAMES } from "@/lib/chain";
import {
  IDENTITY_ABI,
  IDENTITY_REGISTRY_ABI,
  CLAIM_ISSUER_ABI,
  TREX_TOKEN_ABI,
  CHECKER_ABI,
} from "@/lib/abis";
import { requireUser } from "@/lib/auth";

/**
 * The claim inspector's data source: the passport exactly as it sits on chain, and every check
 * the market runs against it — each one a single named contract call with its live answer, so
 * the modal can show an audience the complete checklist without any prose in the way.
 *
 * Read-only throughout. Nothing here touches the app database; that is the point being made.
 */

const TOPIC_LABEL: Record<number, string> = { 7: "KYC", 42: "Accredited investor" };

export type PassportCheck = {
  /** Plain-English item, e.g. "The KYC seal is genuine and not revoked". */
  label: string;
  /** The exact call and its live answer, e.g. "ClaimIssuer.isClaimValid(0x33f1…, 7, seal, note) → true". */
  call: string;
  /** info = not required for this holder (shown neutrally, never as a failure). */
  state: "pass" | "fail" | "info";
  /** Short failure phrase for the verdict banner (labels are positive statements, so they can't be reused). */
  failText?: string;
};

export type PassportView =
  | {
      ok: true;
      identity: Address;
      wallet: Address;
      countryCode: number;
      countryName: string;
      claims: { topic: number; label: string; issuer: Address; note: string; signature: Hex }[];
      checks: PassportCheck[];
      allPass: boolean;
      /** Label of the first failing check, for the verdict banner. */
      failReason: string | null;
    }
  | { ok: false; message: string };

export type ForgeResult =
  | {
      ok: true;
      topic: number;
      originalNote: string;
      forgedNote: string;
      call: string;
      /** Who the seal points at once the note is altered — a stranger, not the provider. */
      recovered: Address | null;
    }
  | { ok: false; message: string };

const shorten = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function decodeNote(data: Hex): string {
  if (data === "0x") return "(empty)";
  try {
    const text = hexToString(data);
    // eslint-disable-next-line no-control-regex
    if (/^[\x20-\x7E]+$/.test(text)) return text;
  } catch {
    /* fall through to hex */
  }
  return data;
}

async function readClaim(identity: Address, topic: number) {
  const ids = (await publicClient.readContract({
    address: identity,
    abi: IDENTITY_ABI,
    functionName: "getClaimIdsByTopic",
    args: [BigInt(topic)],
  })) as readonly Hex[];
  if (ids.length === 0) return null;
  const [, , issuer, signature, data] = (await publicClient.readContract({
    address: identity,
    abi: IDENTITY_ABI,
    functionName: "getClaim",
    args: [ids[0]],
  })) as readonly [bigint, bigint, Address, Hex, Hex, string];
  return { issuer, signature, data };
}

export async function inspectPassport(wallet: Address, identity: Address): Promise<PassportView> {
  try {
    await requireUser();
  } catch {
    return { ok: false, message: "Please sign in." };
  }

  try {
    const a = addresses();
    const topics = [a.topics.KYC, a.topics.PROFESSIONAL];

    const [boundIdentity, verified, country, frozen, paused, ...claimReads] = await Promise.all([
      publicClient.readContract({
        address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_ABI, functionName: "identity", args: [wallet],
      }) as Promise<Address>,
      publicClient.readContract({
        address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_ABI, functionName: "isVerified", args: [wallet],
      }) as Promise<boolean>,
      publicClient
        .readContract({
          address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_ABI, functionName: "investorCountry", args: [wallet],
        })
        .then(Number)
        .catch(() => 0),
      publicClient.readContract({
        address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "isFrozen", args: [wallet],
      }) as Promise<boolean>,
      publicClient.readContract({
        address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "paused", args: [],
      }) as Promise<boolean>,
      ...topics.map((t) => readClaim(identity, t)),
    ]);

    const [countryAllowed, ...claimValid] = await Promise.all([
      publicClient.readContract({
        address: a.venue.allowlistChecker, abi: CHECKER_ABI, functionName: "isCountryAllowed", args: [a.trex.token, country],
      }) as Promise<boolean>,
      ...topics.map((t, i) => {
        const c = claimReads[i];
        if (!c) return Promise.resolve(null);
        return publicClient.readContract({
          address: c.issuer, abi: CLAIM_ISSUER_ABI, functionName: "isClaimValid",
          args: [identity, BigInt(t), c.signature, c.data],
        }) as Promise<boolean>;
      }),
    ]);

    const countryName = COUNTRY_NAMES[country] ?? `code ${country}`;
    const claims = topics.flatMap((t, i) => {
      const c = claimReads[i];
      if (!c) return [];
      return [{ topic: t, label: TOPIC_LABEL[t] ?? `Topic ${t}`, issuer: c.issuer, note: decodeNote(c.data), signature: c.signature }];
    });

    const checks: PassportCheck[] = [];

    const bound = boundIdentity.toLowerCase() === identity.toLowerCase();
    checks.push({
      label: "The wallet is bound to this passport",
      call: `IdentityRegistry.identity(${shorten(wallet)}) → ${shorten(boundIdentity)}`,
      state: bound ? "pass" : "fail",
      failText: "wallet not bound to this passport",
    });

    topics.forEach((t, i) => {
      const held = Boolean(claimReads[i]);
      const label = TOPIC_LABEL[t] ?? `Topic ${t}`;
      if (!held) {
        checks.push({
          label: `${label} claim — not held${t === a.topics.PROFESSIONAL ? " (may trade, cannot provide liquidity)" : ""}`,
          call: `Passport.getClaimIdsByTopic(${t}) → none`,
          state: t === a.topics.PROFESSIONAL ? "info" : "fail",
          failText: `no ${label} claim`,
        });
      } else {
        checks.push({
          label: `The ${label} seal is genuine and not revoked`,
          call: `ClaimIssuer.isClaimValid(${shorten(identity)}, ${t}, seal, note) → ${claimValid[i]}`,
          state: claimValid[i] ? "pass" : "fail",
          failText: `${label} seal invalid or revoked`,
        });
      }
    });

    checks.push({
      label: "The registry accepts the passport as a whole",
      call: `IdentityRegistry.isVerified(${shorten(wallet)}) → ${verified}`,
      state: verified ? "pass" : "fail",
      failText: "registry rejects the passport",
    });
    checks.push({
      label: `The jurisdiction is permitted at the venue (${countryName})`,
      call: `VenueChecker.isCountryAllowed(asset, ${country}) → ${countryAllowed}`,
      state: countryAllowed ? "pass" : "fail",
      failText: `jurisdiction blocked (${countryName})`,
    });
    checks.push({
      label: "The wallet is not frozen by the transfer agent",
      call: `Token.isFrozen(${shorten(wallet)}) → ${frozen}`,
      state: frozen ? "fail" : "pass",
      failText: "wallet frozen by the transfer agent",
    });
    checks.push({
      label: "Trading in the asset is not suspended",
      call: `Token.paused() → ${paused}`,
      state: paused ? "fail" : "pass",
      failText: "asset paused by the issuer",
    });

    const firstFail = checks.find((c) => c.state === "fail") ?? null;

    return {
      ok: true,
      identity,
      wallet,
      countryCode: country,
      countryName,
      claims,
      checks,
      allPass: !firstFail,
      failReason: firstFail ? firstFail.failText ?? firstFail.label : null,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not read the passport from the chain." };
  }
}

/**
 * The forgery demonstration: alter exactly one character of a claim's note and ask the issuer
 * contract the same isClaimValid question. The recovered signer is included so the modal can
 * show *why* it fails — the seal now points at a stranger.
 */
export async function forgeClaim(identity: Address, topic: number): Promise<ForgeResult> {
  try {
    await requireUser();
  } catch {
    return { ok: false, message: "Please sign in." };
  }

  try {
    const claim = await readClaim(identity, topic);
    if (!claim) return { ok: false, message: `This passport holds no claim with topic ${topic}.` };

    const originalNote = decodeNote(claim.data);
    let forged: Hex;
    let forgedNote: string;
    if (originalNote !== claim.data && originalNote !== "(empty)") {
      const i = originalNote.length - 1;
      const c = originalNote[i];
      const swapped = c === "z" || c === "Z" || c === "9" ? "0" : String.fromCharCode(c.charCodeAt(0) + 1);
      forgedNote = originalNote.slice(0, i) + swapped;
      forged = stringToHex(forgedNote);
    } else {
      const last = parseInt(claim.data.slice(-2), 16) ^ 1;
      forged = (claim.data.slice(0, -2) + last.toString(16).padStart(2, "0")) as Hex;
      forgedNote = forged;
    }

    const digest = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "bytes" }],
        [identity, BigInt(topic), forged],
      ),
    );
    let recovered: Address | null = null;
    try {
      recovered = await recoverAddress({ hash: hashMessage({ raw: digest }), signature: claim.signature });
    } catch {
      /* unrecoverable simply stays null */
    }

    const valid = (await publicClient.readContract({
      address: claim.issuer, abi: CLAIM_ISSUER_ABI, functionName: "isClaimValid",
      args: [identity, BigInt(topic), claim.signature, forged],
    })) as boolean;

    return {
      ok: true,
      topic,
      originalNote,
      forgedNote,
      call: `ClaimIssuer.isClaimValid(${shorten(identity)}, ${topic}, seal, forged note) → ${valid}`,
      recovered,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not run the forgery check." };
  }
}
