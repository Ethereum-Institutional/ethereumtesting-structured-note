"use server";

import { revalidatePath } from "next/cache";
import { encodeAbiParameters, keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  addresses,
  publicClient,
  sendTx,
  walletFor,
  KEYS,
  type RoleName,
} from "@/lib/chain";
import {
  ID_FACTORY_ABI,
  IDENTITY_ABI,
  IDENTITY_REGISTRY_WRITE_ABI,
  TREX_TOKEN_ABI,
  TREX_MINT_ABI,
} from "@/lib/abis";
import { explainRevert } from "@/lib/swap";
import {
  getApplication,
  listApplications,
  setStatus,
  updateApplication,
} from "@/lib/db";
import { isComplete, missingFields, type Application, type EditableField } from "@/lib/db/types";

export type PortalResult = { ok: boolean; message: string };

async function run(fn: () => Promise<string>): Promise<PortalResult> {
  try {
    const message = await fn();
    revalidatePath("/portal");
    revalidatePath("/portal/admin");
    revalidatePath("/");
    return { ok: true, message };
  } catch (err) {
    console.error(err);
    revalidatePath("/portal");
    revalidatePath("/portal/admin");
    return { ok: false, message: explainRevert(err) };
  }
}

/** Which demo key, if any, controls a wallet. Needed because an EOA signs its own claims. */
function roleForWallet(wallet: string): RoleName | null {
  for (const [role, pk] of Object.entries(KEYS)) {
    if (privateKeyToAccount(pk as Hex).address.toLowerCase() === wallet.toLowerCase()) {
      return role as RoleName;
    }
  }
  return null;
}

/**
 * Digest committed on-chain.
 *
 * Covers the whole record, so an auditor holding the file can prove it produced the claim.
 * Deliberately excludes nothing and reveals nothing — only the hash travels.
 */
function recordDigest(app: Application): Hex {
  const payload = JSON.stringify({
    reference: app.reference,
    wallet: app.wallet,
    legalName: app.legalName,
    dob: app.dob,
    nationality: app.nationality,
    taxId: app.taxId,
    residentialAddress: app.residentialAddress,
    sourceOfFunds: app.sourceOfFunds,
    classification: app.classification,
    country: app.country,
    screening: [app.sanctionsResult, app.pepResult, app.adverseMediaResult],
  });
  return keccak256(toHex(payload));
}

// --------------------------------------------------------------------- //
//                          Editing and workflow                         //
// --------------------------------------------------------------------- //

export async function saveApplicationFields(
  id: string,
  patch: Record<string, string>,
  actor = "compliance officer",
): Promise<PortalResult> {
  return run(async () => {
    const app = await getApplication(id);
    if (!app) throw new Error(`No application ${id}`);
    if (app.status === "approved") throw new Error("This file is approved; reopen it before editing.");

    const clean: Partial<Application> = {};
    for (const [k, v] of Object.entries(patch)) {
      const value = v.trim();
      if (k === "country") {
        clean.country = value === "" ? null : Number(value);
      } else if (k === "classification") {
        clean.classification = value === "wholesale" ? "wholesale" : "retail";
      } else {
        (clean as any)[k] = value === "" ? null : value;
      }
    }

    const updated = await updateApplication(id, clean, actor, "fields edited");
    const missing = missingFields(updated);
    return missing.length === 0
      ? `Saved. The file is complete and ready for sign-off.`
      : `Saved. Still outstanding: ${missing.join(", ")}.`;
  });
}

export async function moveToReview(id: string, actor = "compliance officer"): Promise<PortalResult> {
  return run(async () => {
    const app = await getApplication(id);
    if (!app) throw new Error(`No application ${id}`);
    const missing = missingFields(app);
    if (missing.length) throw new Error(`Cannot review an incomplete file. Outstanding: ${missing.join(", ")}.`);
    await setStatus(id, "in_review", actor);
    return `${app.reference} moved to review.`;
  });
}

export async function rejectApplication(id: string, reason: string, actor = "compliance officer"): Promise<PortalResult> {
  return run(async () => {
    const app = await getApplication(id);
    if (!app) throw new Error(`No application ${id}`);
    await updateApplication(id, { status: "rejected", reviewerNotes: reason || app.reviewerNotes }, actor, "rejected");
    return `${app.reference} rejected. No on-chain permission was granted.`;
  });
}

export async function reopenApplication(id: string, actor = "compliance officer"): Promise<PortalResult> {
  return run(async () => {
    const app = await getApplication(id);
    if (!app) throw new Error(`No application ${id}`);
    await setStatus(id, "submitted", actor, "reopened for amendment");
    return `${app.reference} reopened. On-chain permissions already granted are unaffected — revoke those from the console.`;
  });
}

/** The investor's own submission of a missing detail. */
export async function submitMissingDetail(
  id: string,
  field: string,
  value: string,
): Promise<PortalResult> {
  return run(async () => {
    const app = await getApplication(id);
    if (!app) throw new Error(`No application ${id}`);
    if (!value.trim()) throw new Error("Please provide a value.");
    const updated = await updateApplication(id, { [field]: value.trim() } as any, app.applicantName, "applicant supplied detail");
    const missing = missingFields(updated);
    if (missing.length === 0 && updated.status === "submitted") {
      await setStatus(id, "in_review", app.applicantName, "file completed by applicant");
      return "Thank you — your file is complete and has gone to compliance for review.";
    }
    return missing.length
      ? `Saved. Still needed: ${missing.join(", ")}.`
      : "Saved.";
  });
}

// --------------------------------------------------------------------- //
//                        Approval → on-chain grant                      //
// --------------------------------------------------------------------- //

/**
 * Signs off an application and turns it into on-chain permission.
 *
 * Handles both kinds of holder in this demo:
 *   - a self-custodied wallet gets its own ONCHAINID with itself as management key, and signs
 *     the claim attachment itself, which is the ordinary ERC-3643 flow;
 *   - a custody account is a contract and cannot sign, so its identity is created with the
 *     issuer holding the management key.
 *
 * Claims carry the application reference and a digest of the record — never its contents. A
 * wallet freeze is lifted in the same action so an approved investor ends up fully cleared
 * rather than half-cleared.
 */
export async function approveApplication(id: string, actor = "compliance officer"): Promise<PortalResult> {
  return run(async () => {
    const a = addresses();
    const app = await getApplication(id);
    if (!app) throw new Error(`No application ${id}`);
    if (app.status === "approved") throw new Error("Already approved.");
    if (!isComplete(app)) throw new Error(`File incomplete. Outstanding: ${missingFields(app).join(", ")}.`);

    const account = app.wallet as Address;
    const digest = recordDigest(app);
    const claimText = `KYC:${app.reference}:${digest}`;

    const code = await publicClient.getCode({ address: account });
    const isContract = Boolean(code && code !== "0x");
    const walletRole = roleForWallet(account);
    if (!isContract && !walletRole) {
      throw new Error("This demo does not hold a key for that wallet, so it cannot sign its own claim.");
    }

    // 1. Identity.
    let identity = (await publicClient.readContract({
      address: a.trex.idFactory, abi: ID_FACTORY_ABI, functionName: "getIdentity", args: [account],
    })) as Address;

    if (identity === "0x0000000000000000000000000000000000000000") {
      const salt = `portal-${app.reference.toLowerCase()}`;
      const h = isContract
        ? await sendTx("issuer", {
            address: a.trex.idFactory,
            abi: ID_FACTORY_ABI,
            functionName: "createIdentityWithManagementKeys",
            args: [account, salt, [keccak256(encodeAbiParameters([{ type: "address" }], [privateKeyToAccount(KEYS.issuer).address]))]],
          })
        : await sendTx("issuer", {
            address: a.trex.idFactory,
            abi: ID_FACTORY_ABI,
            functionName: "createIdentity",
            args: [account, salt],
          });
      await publicClient.waitForTransactionReceipt({ hash: h });
      identity = (await publicClient.readContract({
        address: a.trex.idFactory, abi: ID_FACTORY_ABI, functionName: "getIdentity", args: [account],
      })) as Address;
    }

    // 2. Claims. Wholesale classification earns the professional-investor topic as well,
    //    which is what the venue requires before an account may provide liquidity.
    const topics = app.classification === "wholesale" ? [a.topics.KYC, a.topics.PROFESSIONAL] : [a.topics.KYC];
    const claimSigner = walletFor("claimSigner");
    const signerRole: RoleName = isContract ? "issuer" : (walletRole as RoleName);

    for (const topic of topics) {
      const existing = (await publicClient.readContract({
        address: identity, abi: IDENTITY_ABI, functionName: "getClaimIdsByTopic", args: [BigInt(topic)],
      })) as readonly Hex[];
      if (existing.length > 0) continue;

      const data = toHex(topic === a.topics.KYC ? claimText : `PRO:${claimText}`);
      const sigDigest = keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }, { type: "bytes" }],
          [identity, BigInt(topic), data],
        ),
      );
      const signature = await claimSigner.signMessage({ account: claimSigner.account, message: { raw: sigDigest } });
      const h = await sendTx(signerRole, {
        address: identity,
        abi: IDENTITY_ABI,
        functionName: "addClaim",
        args: [BigInt(topic), 1n, a.trex.claimIssuer, signature, data, ""],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    // 3. Register as a holder of record, if not already.
    const registered = (await publicClient.readContract({
      address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_WRITE_ABI, functionName: "contains", args: [account],
    })) as boolean;
    if (!registered) {
      const h = await sendTx("agent", {
        address: a.trex.identityRegistry,
        abi: IDENTITY_REGISTRY_WRITE_ABI,
        functionName: "registerIdentity",
        args: [account, identity, app.country!],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    // 4. Lift any wallet freeze.
    const frozen = (await publicClient.readContract({
      address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "isFrozen", args: [account],
    })) as boolean;
    if (frozen) {
      const h = await sendTx("agent", {
        address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "setAddressFrozen", args: [account, false],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    // 5. Allocate the subscription.
    if (app.allocation && Number(app.allocation) > 0) {
      const held = (await publicClient.readContract({
        address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "balanceOf", args: [account],
      })) as bigint;
      const target = parseUnits(app.allocation, a.trex.decimals);
      if (held < target) {
        const h = await sendTx("agent", {
          address: a.trex.token, abi: TREX_MINT_ABI, functionName: "mint", args: [account, target - held],
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
    }

    const verified = (await publicClient.readContract({
      address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_WRITE_ABI, functionName: "isVerified", args: [account],
    })) as boolean;
    if (!verified) throw new Error("Registered, but isVerified() is still false — check the claim topics.");

    await updateApplication(
      id,
      {
        status: "approved",
        approvedAt: new Date().toISOString(),
        onchainIdentity: identity,
        claimDigest: digest,
      },
      actor,
      "approved and granted on-chain",
    );

    const perms = app.classification === "wholesale" ? "trade and provide liquidity" : "trade";
    return `${app.reference} approved. ${app.applicantName} holds identity ${identity.slice(0, 8)}… with ${topics.length} attested claim${topics.length > 1 ? "s" : ""}${frozen ? ", the freeze is lifted" : ""}, and may now ${perms}. On-chain: reference plus digest ${digest.slice(0, 10)}… only.`;
  });
}

export async function listForAdmin(): Promise<Application[]> {
  return listApplications();
}
