"use server";

import { revalidatePath } from "next/cache";
import { encodeAbiParameters, formatUnits, keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addresses, publicClient, sendTx, walletFor, KEYS, type RoleName } from "@/lib/chain";
import {
  ID_FACTORY_ABI,
  IDENTITY_ABI,
  IDENTITY_REGISTRY_WRITE_ABI,
  TREX_TOKEN_ABI,
  TREX_MINT_ABI,
  CUSTODY_FACTORY_ABI,
  DEMO_USDC_ABI,
} from "@/lib/abis";
import { explainRevert } from "@/lib/swap";
import { requireUser, requireAdmin, requestMagicLink, signOut } from "@/lib/auth";
import {
  getApplication,
  getApplicationByUser,
  insertApplications,
  updateApplication,
  setStatus,
  nextReference,
  ensureSchema,
} from "@/lib/db";
import {
  assessAccreditation,
  accreditationPermitsApproval,
  isComplete,
  missingFields,
  requiredFields,
  validatePatch,
  type Application,
} from "@/lib/db/types";
import { generateProfile } from "@/lib/fake";

export type Result = { ok: boolean; message: string; data?: any };

async function run(fn: () => Promise<Result | string>): Promise<Result> {
  try {
    const r = await fn();
    for (const p of ["/portal", "/portal/admin", "/account", "/"]) revalidatePath(p);
    return typeof r === "string" ? { ok: true, message: r } : r;
  } catch (err) {
    console.error(err);
    return { ok: false, message: describeError(err) };
  }
}

/**
 * Turns a thrown error into something the operator can act on.
 *
 * Chain reverts go through the selector decoder; everything else is a validation failure whose
 * own message is already the useful thing to say. Running every error through the revert decoder
 * turned "cannot approve: net assets below the threshold" into "Reverted (see server log)", which
 * tells the compliance officer nothing.
 */
function describeError(err: unknown): string {
  const e = err as any;
  const looksLikeChainError =
    Boolean(e?.shortMessage) || Boolean(e?.data) || /revert|0x[0-9a-f]{8}/i.test(String(e?.message ?? ""));
  if (!looksLikeChainError && e?.message) return String(e.message);
  return explainRevert(err);
}

// --------------------------------------------------------------------- //
//                                  Auth                                 //
// --------------------------------------------------------------------- //

export async function sendMagicLink(
  email: string,
  origin: string,
  staffCode?: string,
): Promise<Result> {
  return run(async () => {
    await ensureSchema();
    const { user, url, emailed, grantedRole } = await requestMagicLink(email, origin, staffCode);
    const asWho = grantedRole === "admin" ? "compliance staff" : "an investor";
    return {
      ok: true,
      message: emailed
        ? `A sign-in link is on its way to ${user.email} — you will sign in as ${asWho}.`
        : `Sign-in link ready for ${user.email}. You will sign in as ${asWho}. No mail provider is configured, so use the link below.`,
      data: { url, emailed, role: grantedRole },
    };
  });
}

export async function signOutAction(): Promise<Result> {
  return run(async () => {
    await signOut();
    return "Signed out.";
  });
}

// --------------------------------------------------------------------- //
//                          Investor onboarding                          //
// --------------------------------------------------------------------- //

/**
 * Creates the investor's file on first sign-in.
 *
 * Deliberately does no on-chain work. Provisioning a custody account takes three transactions,
 * and doing them here meant sign-up held its request open for the better part of ten seconds —
 * which collapsed as soon as several people signed up at once, because those transactions
 * serialise behind one signer. Nobody should wait on a spinner after typing their email.
 *
 * The chain work moves to {provisionMyAccount}, which the account page drives once it has
 * rendered. See ProvisionWatcher.
 */
export async function ensureMyAccount(): Promise<Result> {
  return run(async () => {
    const user = await requireUser();
    if (user.role !== "investor") return { ok: true, message: "Staff account — no investor file." };

    let app = await getApplicationByUser(user.id);

    if (!app) {
      const gen = generateProfile(user.email);
      const reference = await nextReference();
      const now = new Date().toISOString();

      const draft: Application = {
        id: `app_${user.id.slice(4)}`,
        reference,
        userId: user.id,
        applicantName: gen.applicantName,
        wallet: null as any,
        status: "draft",
        submittedAt: null,
        accountType: gen.accountType,
        legalName: gen.legalName ?? null,
        dob: gen.dob ?? null,
        nationality: gen.nationality ?? null,
        residentialAddress: null,
        passportNumber: null,
        taxId: gen.taxId ?? null,
        entityName: gen.entityName ?? null,
        entityForm: gen.entityForm ?? null,
        registrationNumber: gen.registrationNumber ?? null,
        incorporationCountry: gen.incorporationCountry ?? null,
        registeredOffice: null,
        repName: gen.repName ?? null,
        repPassportNumber: null,
        country: gen.country,
        phone: gen.phone,
        sourceOfFunds: gen.sourceOfFunds,
        annualIncome: gen.annualIncome ?? null,
        netFinancialAssets: gen.netFinancialAssets ?? null,
        entityNetAssets: gen.entityNetAssets ?? null,
        accreditationLevel: "retail",
        accreditationBasis: null,
        sanctionsResult: gen.sanctionsResult,
        pepResult: gen.pepResult,
        adverseMediaResult: gen.adverseMediaResult,
        allocation: null,
        startingCash: gen.startingCash,
        reviewerNotes: null,
        rejectionReason: null,
        onchainIdentity: null,
        claimDigest: null,
        approvedAt: null,
        approvedBy: null,
        updatedAt: now,
      };

      const assessed = assessAccreditation(draft);
      draft.accreditationLevel = assessed.level;
      draft.accreditationBasis = assessed.basis;

      await insertApplications([draft]);
      // Use the record we just built rather than reading it back — one fewer round trip on the
      // slowest path a new user takes.
      app = draft;
    }

    return {
      ok: true,
      message: "Account ready.",
      data: { applicationId: app.id, needsProvisioning: !app.wallet },
    };
  });
}

/**
 * Deploys the client's custody account and funds it, then records the address.
 *
 * Idempotent and safe to call repeatedly: it re-checks each step against the chain rather than
 * assuming, so a retry after a partial failure finishes the job instead of duplicating it.
 */
export async function provisionMyAccount(): Promise<Result> {
  return run(async () => {
    const user = await requireUser();
    const app = await getApplicationByUser(user.id);
    if (!app) throw new Error("No application on file.");

    if (app.wallet) {
      // Repair path: an account provisioned before approvals were part of provisioning would look
      // funded and permitted yet fail its first order inside Permit2.
      await ensureAccountApprovals(app.wallet as Address);
      return "Account already provisioned.";
    }

    const provisioned = await provisionCustodyAccount(app);
    if (!provisioned) {
      throw new Error("Could not reach the custody network. Your details are saved — try again shortly.");
    }
    await updateApplication(app.id, { wallet: provisioned }, "platform", "custody account provisioned");
    return `Custody account ready: ${provisioned.slice(0, 10)}…`;
  });
}

/** Deploys the client's segregated custody account and funds it with settlement cash. */
async function provisionCustodyAccount(app: Application): Promise<Address | null> {
  try {
    const a = addresses();
    const factory = a.custody?.factory as Address;
    if (!factory) return null;

    const clientRef = app.reference;
    const existing = (await publicClient.readContract({
      address: factory,
      abi: CUSTODY_FACTORY_ABI,
      functionName: "accountOf",
      args: [keccak256(toHex(clientRef))],
    })) as Address;

    let account = existing;
    if (account === "0x0000000000000000000000000000000000000000") {
      const h = await sendTx("custodian", {
        address: factory,
        abi: CUSTODY_FACTORY_ABI,
        functionName: "createAccount",
        args: [clientRef],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      account = (await publicClient.readContract({
        address: factory,
        abi: CUSTODY_FACTORY_ABI,
        functionName: "accountOf",
        args: [keccak256(toHex(clientRef))],
      })) as Address;
    }
    if (account === "0x0000000000000000000000000000000000000000") return null;

    // Approvals. A freshly created account has none, so without this the client's first order
    // reverts inside Permit2 with AllowanceExpired — the account looks funded and permitted, but
    // cannot move a token. Batched through the account so it is one custodian action per client.
    await grantAccountApprovals(account);

    // Settlement cash, so the client can trade the moment they are approved.
    const cash = (await publicClient.readContract({
      address: a.venue.usdc,
      abi: DEMO_USDC_ABI,
      functionName: "balanceOf",
      args: [account],
    })) as bigint;
    const target = parseUnits(app.startingCash ?? "250000", 6);
    if (cash < target) {
      const h = await sendTx("issuer", {
        address: a.venue.usdc,
        abi: DEMO_USDC_ABI,
        functionName: "mint",
        args: [account, target - cash],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }
    return account;
  } catch (e) {
    console.error("custody provisioning failed", e);
    return null;
  }
}

/** Grants approvals only if they are missing, so the common path costs one read. */
async function ensureAccountApprovals(account: Address): Promise<void> {
  try {
    const a = addresses();
    const { ERC20_ABI } = await import("@/lib/abis");
    const allowance = (await publicClient.readContract({
      address: a.venue.usdc,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account, a.venue.permit2],
    })) as bigint;
    if (allowance === 0n) await grantAccountApprovals(account);
  } catch (e) {
    console.error("approval check failed", e);
  }
}

/**
 * Sets the token and Permit2 approvals a custody account needs in order to trade.
 *
 * Idempotent: re-approving costs a transaction but never breaks anything, and checking six
 * allowances first would cost more round trips than it saves.
 */
async function grantAccountApprovals(account: Address): Promise<void> {
  const a = addresses();
  const { CUSTODY_ACCOUNT_ABI, ERC20_ABI, PERMIT2_ABI } = await import("@/lib/abis");
  const { encodeFunctionData, maxUint256, maxUint160, maxUint48 } = await import("viem");

  const approveToPermit2 = (token: Address) => ({
    target: token,
    value: 0n,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [a.venue.permit2, maxUint256] }),
  });
  const permit2Approve = (token: Address, spender: Address) => ({
    target: a.venue.permit2,
    value: 0n,
    data: encodeFunctionData({
      abi: PERMIT2_ABI,
      functionName: "approve",
      args: [token, spender, maxUint160, Number(maxUint48)],
    }),
  });

  const calls = [
    approveToPermit2(a.trex.token),
    approveToPermit2(a.venue.usdc),
    permit2Approve(a.trex.token, a.venue.router),
    permit2Approve(a.venue.usdc, a.venue.router),
    permit2Approve(a.trex.token, a.venue.positionManager),
    permit2Approve(a.venue.usdc, a.venue.positionManager),
  ];

  const hash = await sendTx("custodian", {
    address: account,
    abi: CUSTODY_ACCOUNT_ABI,
    functionName: "execute",
    args: [calls],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

/**
 * Validates a form patch, coerces it, and recomputes accreditation from the merged record.
 *
 * Rejects the whole patch when any field is invalid rather than writing the good half: a
 * half-applied edit is harder for an operator to reason about than a refusal that names the
 * problem.
 */
function normalisePatch(app: Application, patch: Record<string, string>): Partial<Application> {
  const { clean, errors } = validatePatch(patch);
  if (errors.length) throw new Error(errors.join(" "));
  const merged = { ...app, ...clean } as Application;
  const assessed = assessAccreditation(merged);
  return { ...clean, accreditationLevel: assessed.level, accreditationBasis: assessed.basis } as Partial<Application>;
}

export async function updateMyProfile(patch: Record<string, string>): Promise<Result> {
  return run(async () => {
    const user = await requireUser();
    const app = await getApplicationByUser(user.id);
    if (!app) throw new Error("No application on file.");
    if (app.status === "approved") throw new Error("Your account is approved; contact us to change details.");
    if (app.status === "in_review") throw new Error("Your file is under review and cannot be edited right now.");

    // An investor may only touch their own declared details, never screening or allocation.
    const allowed = new Set([
      ...requiredFields(app.accountType),
      "phone", "annualIncome", "netFinancialAssets", "entityNetAssets", "country", "applicantName",
    ]);
    const submitted = Object.keys(patch);
    const ignored = submitted.filter((k) => !allowed.has(k));
    const filtered = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.has(k)));
    if (Object.keys(filtered).length === 0) {
      throw new Error("None of those fields are yours to change.");
    }

    const updated = await updateApplication(app.id, normalisePatch(app, filtered), user.email, "details updated by client");
    const gaps = missingFields(updated);
    // Silently dropping fields invites the suspicion that they were accepted.
    const note = ignored.length ? ` Ignored (not yours to set): ${ignored.join(", ")}.` : "";
    return gaps.length
      ? `Saved.${note} Still outstanding: ${gaps.join(", ")}.`
      : `Saved.${note} Your file is complete — you can submit it for review.`;
  });
}

export async function submitForReview(): Promise<Result> {
  return run(async () => {
    const user = await requireUser();
    const app = await getApplicationByUser(user.id);
    if (!app) throw new Error("No application on file.");
    if (!isComplete(app)) throw new Error(`Still outstanding: ${missingFields(app).join(", ")}.`);
    if (app.status === "in_review") throw new Error("Already submitted — we are reviewing it.");
    if (app.status === "approved") throw new Error("Already approved.");

    const assessed = assessAccreditation(app);
    await updateApplication(
      app.id,
      { status: "in_review", submittedAt: new Date().toISOString(), accreditationLevel: assessed.level, accreditationBasis: assessed.basis },
      user.email,
      "submitted for KYC review",
    );
    return accreditationPermitsApproval(assessed.level)
      ? "Submitted. You qualify as an accredited investor on the figures declared; compliance will confirm."
      : "Submitted. On the figures declared you do not meet the accredited-investor test, so this fund may not be available to you.";
  });
}

// --------------------------------------------------------------------- //
//                              Admin review                             //
// --------------------------------------------------------------------- //

export async function adminSaveFields(id: string, patch: Record<string, string>): Promise<Result> {
  return run(async () => {
    const admin = await requireAdmin();
    const app = await getApplication(id);
    if (!app) throw new Error(`No application ${id}`);
    if (app.status === "approved") throw new Error("Approved files are read-only. Reopen it first.");

    const updated = await updateApplication(app.id, normalisePatch(app, patch), admin.email, "fields edited");
    const gaps = missingFields(updated);
    const acc = updated.accreditationLevel;
    const note = accreditationPermitsApproval(acc)
      ? `Accreditation: ${acc}.`
      : `Accreditation: ${acc} — this file cannot be approved for a restricted fund.`;
    return gaps.length ? `Saved. Outstanding: ${gaps.join(", ")}. ${note}` : `Saved. ${note}`;
  });
}

export async function adminReject(id: string, reason: string): Promise<Result> {
  return run(async () => {
    const admin = await requireAdmin();
    const app = await getApplication(id);
    if (!app) throw new Error(`No application ${id}`);
    if (!reason.trim()) throw new Error("Give a reason — it goes on the file.");
    await updateApplication(id, { status: "rejected", rejectionReason: reason.trim() }, admin.email, "rejected");
    return `${app.reference} rejected. No on-chain permission was granted.`;
  });
}

export async function adminReopen(id: string): Promise<Result> {
  return run(async () => {
    const admin = await requireAdmin();
    const app = await getApplication(id);
    if (!app) throw new Error(`No application ${id}`);
    await setStatus(id, "submitted", admin.email, "reopened for amendment");
    return `${app.reference} reopened. Permissions already granted on-chain are unaffected — revoke those from the console.`;
  });
}

/**
 * Signs off an application and turns it into on-chain permission.
 *
 * The accreditation gate is enforced here and not only in the UI: a restricted fund must not
 * admit a retail investor, and a disabled button is not a control.
 *
 * Claims carry the application reference and a digest of the record, never its contents.
 */
export async function adminApprove(id: string): Promise<Result> {
  return run(async () => {
    const admin = await requireAdmin();
    const a = addresses();
    const app = await getApplication(id);
    if (!app) throw new Error(`No application ${id}`);
    if (app.status === "approved") throw new Error("Already approved.");
    if (!app.wallet) throw new Error("No custody account provisioned for this client yet.");
    if (!isComplete(app)) throw new Error(`File incomplete. Outstanding: ${missingFields(app).join(", ")}.`);

    const assessed = assessAccreditation(app);
    if (!accreditationPermitsApproval(assessed.level)) {
      throw new Error(
        `Cannot approve: ${assessed.basis}. This fund is restricted to accredited and institutional investors.`,
      );
    }

    const account = app.wallet as Address;
    const digest = recordDigest(app);
    const claimText = `KYC:${app.reference}:${digest}`;

    const code = await publicClient.getCode({ address: account });
    const isContract = Boolean(code && code !== "0x");
    const walletRole = roleForWallet(account);
    if (!isContract && !walletRole) throw new Error("No key held for that wallet, so it cannot sign its own claim.");

    // 1. Identity. A contract cannot sign for itself, so the issuer holds its management key.
    let identity = (await publicClient.readContract({
      address: a.trex.idFactory, abi: ID_FACTORY_ABI, functionName: "getIdentity", args: [account],
    })) as Address;

    if (identity === "0x0000000000000000000000000000000000000000") {
      const salt = `platform-${app.reference.toLowerCase()}`;
      const h = isContract
        ? await sendTx("issuer", {
            address: a.trex.idFactory,
            abi: ID_FACTORY_ABI,
            functionName: "createIdentityWithManagementKeys",
            args: [account, salt, [keccak256(encodeAbiParameters([{ type: "address" }], [privateKeyToAccount(KEYS.issuer).address]))]],
          })
        : await sendTx("issuer", {
            address: a.trex.idFactory, abi: ID_FACTORY_ABI, functionName: "createIdentity", args: [account, salt],
          });
      await publicClient.waitForTransactionReceipt({ hash: h });
      identity = (await publicClient.readContract({
        address: a.trex.idFactory, abi: ID_FACTORY_ABI, functionName: "getIdentity", args: [account],
      })) as Address;
    }

    // 2. Claims. Accreditation earns the professional-investor topic, which is what the venue
    //    requires before an account may provide liquidity.
    const topics = [a.topics.KYC, a.topics.PROFESSIONAL];
    const claimSigner = walletFor("claimSigner");
    const signerRole: RoleName = isContract ? "issuer" : (walletRole as RoleName);

    for (const topic of topics) {
      const existing = (await publicClient.readContract({
        address: identity, abi: IDENTITY_ABI, functionName: "getClaimIdsByTopic", args: [BigInt(topic)],
      })) as readonly Hex[];
      if (existing.length > 0) continue;

      const data = toHex(topic === a.topics.KYC ? claimText : `ACCREDITED:${assessed.level}:${claimText}`);
      const sigDigest = keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }, { type: "bytes" }],
          [identity, BigInt(topic), data],
        ),
      );
      const signature = await claimSigner.signMessage({ account: claimSigner.account, message: { raw: sigDigest } });
      const h = await sendTx(signerRole, {
        address: identity, abi: IDENTITY_ABI, functionName: "addClaim",
        args: [BigInt(topic), 1n, a.trex.claimIssuer, signature, data, ""],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    // 3. Register as a holder of record.
    const registered = (await publicClient.readContract({
      address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_WRITE_ABI, functionName: "contains", args: [account],
    })) as boolean;
    if (!registered) {
      const h = await sendTx("agent", {
        address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_WRITE_ABI,
        functionName: "registerIdentity", args: [account, identity, app.country!],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    // 4. Lift any wallet freeze, so an approved client ends up fully cleared.
    const frozen = (await publicClient.readContract({
      address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "isFrozen", args: [account],
    })) as boolean;
    if (frozen) {
      const h = await sendTx("agent", {
        address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "setAddressFrozen", args: [account, false],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    // 5. Allocate the subscription, if one was set.
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
        approvedBy: admin.email,
        onchainIdentity: identity,
        claimDigest: digest,
        accreditationLevel: assessed.level,
        accreditationBasis: assessed.basis,
      },
      admin.email,
      "approved and granted on-chain",
    );

    return `${app.reference} approved as ${assessed.level}. ${app.applicantName} holds identity ${identity.slice(0, 10)}… and may now trade and provide liquidity. On-chain: reference plus digest ${digest.slice(0, 10)}… only.`;
  });
}

// --------------------------------------------------------------------- //

function roleForWallet(wallet: string): RoleName | null {
  for (const [role, pk] of Object.entries(KEYS)) {
    if (privateKeyToAccount(pk as Hex).address.toLowerCase() === wallet.toLowerCase()) return role as RoleName;
  }
  return null;
}

/** Commits to the whole record, so an auditor holding the file can prove it produced the claim. */
function recordDigest(app: Application): Hex {
  return keccak256(
    toHex(
      JSON.stringify({
        reference: app.reference,
        wallet: app.wallet,
        accountType: app.accountType,
        legalName: app.legalName,
        dob: app.dob,
        nationality: app.nationality,
        residentialAddress: app.residentialAddress,
        passportNumber: app.passportNumber,
        taxId: app.taxId,
        entityName: app.entityName,
        registrationNumber: app.registrationNumber,
        registeredOffice: app.registeredOffice,
        repName: app.repName,
        repPassportNumber: app.repPassportNumber,
        country: app.country,
        sourceOfFunds: app.sourceOfFunds,
        accreditation: [app.accreditationLevel, app.accreditationBasis],
        screening: [app.sanctionsResult, app.pepResult, app.adverseMediaResult],
      }),
    ),
  );
}

// --------------------------------------------------------------------- //
//                        Investor trading (custodial)                   //
// --------------------------------------------------------------------- //

/**
 * Buys or sells the fund on behalf of the signed-in investor.
 *
 * The investor never signs: the custodian sends the transaction through their custody account,
 * and the permissioned pool's hook evaluates *the account's* identity, not the custodian's.
 * That is what closes the loop — sign up, get approved, and actually hold the asset.
 */
export async function tradeForMyAccount(direction: "buy" | "sell", amount: string): Promise<Result> {
  return run(async () => {
    const user = await requireUser();
    const app = await getApplicationByUser(user.id);
    if (!app) throw new Error("No account on file.");
    if (app.status !== "approved") throw new Error("Your account is not approved for trading yet.");
    if (!app.wallet) throw new Error("No custody account provisioned.");
    if (!amount || Number(amount) <= 0) throw new Error("Enter an amount.");

    const a = addresses();
    const { buildSwap } = await import("@/lib/swap");
    const { CUSTODY_ACCOUNT_ABI, ROUTER_ABI, ERC20_ABI } = await import("@/lib/abis");
    const { encodeFunctionData, formatUnits } = await import("viem");

    const { unlockData } = buildSwap(a, direction, amount);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const outToken = direction === "buy" ? a.trex.token : a.venue.usdc;
    const outDecimals = direction === "buy" ? a.trex.decimals : 6;

    const balanceOf = async () =>
      (await publicClient.readContract({
        address: outToken, abi: ERC20_ABI, functionName: "balanceOf", args: [app.wallet as Address],
      })) as bigint;

    const before = await balanceOf();
    const call = {
      address: app.wallet as Address,
      abi: CUSTODY_ACCOUNT_ABI,
      functionName: "executeOne",
      args: [
        a.venue.router,
        0n,
        encodeFunctionData({ abi: ROUTER_ABI, functionName: "execute", args: [unlockData, deadline] }),
      ],
    };

    const { simulateAs } = await import("@/lib/chain");
    await simulateAs("custodian", call);
    const hash = await sendTx("custodian", call);
    await publicClient.waitForTransactionReceipt({ hash });

    const received = formatUnits((await balanceOf()) - before, outDecimals);
    const inSym = direction === "buy" ? "USDC" : a.trex.tokenSymbol;
    const outSym = direction === "buy" ? a.trex.tokenSymbol : "USDC";
    return `Order filled: ${amount} ${inSym} → ${received} ${outSym}. Settled in your custody account.`;
  });
}

// --------------------------------------------------------------------- //
//                        Holdings administration                        //
// --------------------------------------------------------------------- //

/**
 * Issues fund units to an approved holder.
 *
 * Separate from editing the file, which is why it still works once a file is approved and locked:
 * locking protects the *record* of who someone is, not the ongoing administration of what they
 * hold. Previously an allocation could only be set before approval, so there was no way to give
 * an approved investor units at all.
 *
 * The token's own compliance rules still apply — minting to a wallet the issuer has not verified
 * reverts on-chain, which is the correct place for that check rather than here.
 */
export async function adminAllocateUnits(id: string, amount: string): Promise<Result> {
  return run(async () => {
    const admin = await requireAdmin();
    const a = addresses();
    const app = await getApplication(id);
    if (!app) throw new Error(`No application ${id}`);
    if (!app.wallet) throw new Error("This client has no custody account yet.");
    if (app.status !== "approved") {
      throw new Error("Approve the file first — the asset will not transfer to an unverified holder.");
    }

    const treasury = a.treasury?.account;
    if (!treasury) throw new Error("No treasury account is configured for this fund.");

    const units = Number(String(amount).replace(/[, _]/g, ""));
    if (!Number.isFinite(units) || units <= 0) throw new Error("Enter a number of units greater than zero.");
    const wanted = parseUnits(String(units), a.trex.decimals);

    const available = (await publicClient.readContract({
      address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "balanceOf", args: [treasury],
    })) as bigint;
    if (available < wanted) {
      throw new Error(
        `Treasury holds ${formatUnits(available, a.trex.decimals)} units — not enough to allocate ${units.toLocaleString()}.`,
      );
    }

    // A transfer out of treasury, not a mint. It therefore passes the asset's own rules on both
    // sides: the treasury must be a permitted sender and the client a verified recipient, and the
    // issuer's compliance modules see it. Minting would bypass all of that, and would also
    // conjure units that were never subscribed for.
    const { CUSTODY_ACCOUNT_ABI, ERC20_ABI } = await import("@/lib/abis");
    const { encodeFunctionData } = await import("viem");
    const hash = await sendTx("custodian", {
      address: treasury,
      abi: CUSTODY_ACCOUNT_ABI,
      functionName: "executeOne",
      args: [
        a.trex.token,
        0n,
        encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [app.wallet as Address, wanted] }),
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const [held, left] = (await Promise.all([
      publicClient.readContract({ address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "balanceOf", args: [app.wallet as Address] }),
      publicClient.readContract({ address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "balanceOf", args: [treasury] }),
    ])) as [bigint, bigint];

    await updateApplication(
      id,
      { allocation: String(Number(app.allocation ?? 0) + units) },
      admin.email,
      `allocated ${units} units from treasury`,
    );

    return `Allocated ${units.toLocaleString()} units from treasury to ${app.applicantName}. They hold ${formatUnits(held, a.trex.decimals)}; treasury has ${formatUnits(left, a.trex.decimals)} left.`;
  });
}

/**
 * Tops up a client's settlement cash.
 *
 * Unrestricted, unlike the fund itself — the stablecoin leg of the pool is a plain ERC-20, so this
 * works whatever the client's KYC state. Useful when someone has spent their opening balance and
 * wants to keep trading.
 */
export async function adminFundCash(id: string, amount: string): Promise<Result> {
  return run(async () => {
    const admin = await requireAdmin();
    const a = addresses();
    const app = await getApplication(id);
    if (!app) throw new Error(`No application ${id}`);
    if (!app.wallet) throw new Error("This client has no custody account yet.");

    const cash = Number(String(amount).replace(/[, _]/g, ""));
    if (!Number.isFinite(cash) || cash <= 0) throw new Error("Enter an amount greater than zero.");

    const { DEMO_USDC_ABI } = await import("@/lib/abis");
    const hash = await sendTx("issuer", {
      address: a.venue.usdc,
      abi: DEMO_USDC_ABI,
      functionName: "mint",
      args: [app.wallet as Address, parseUnits(String(cash), 6)],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const balance = (await publicClient.readContract({
      address: a.venue.usdc, abi: DEMO_USDC_ABI, functionName: "balanceOf", args: [app.wallet as Address],
    })) as bigint;

    await updateApplication(id, { startingCash: app.startingCash }, admin.email, `funded ${cash} USDC`);
    return `Funded ${cash.toLocaleString()} USDC. ${app.applicantName} now holds ${formatUnits(balance, 6)} USDC.`;
  });
}
