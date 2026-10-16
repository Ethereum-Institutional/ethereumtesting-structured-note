import "server-only";
import { randomBytes } from "node:crypto";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { getStore, type Admission, type AdmissionRoute, type Client, type Registrant } from "../store.ts";
import { hasRole, type Role } from "../operators.ts";
import { claimsOf, consented, context, consent, createIdentity, eligibility, handOver, identityOf, isIdentity, recordHash, register, revoke, unregister, vouch } from "./onchain.ts";
import { accountFor, custodianAddress, openAccount, type Custodian } from "./custody.ts";
import { ROUTE_LABEL as LABELS } from "../routes.ts";

/**
 * Onboarding by role (ADR 0089): the client chooses a custody route, the bank confirms it against
 * its KYB record, the account's identity is created and the bank vouches for the deposit; then the
 * client asks for the note, and the onboarding agent vouches for it.
 *
 * | Route             | The wallet                         | Who manages the identity      |
 * |-------------------|------------------------------------|-------------------------------|
 * | bank-custody      | an account at the bank's custody platform | the custody platform   |
 * | third-party       | an account at a third-party custodian     | the custodian          |
 * | self-custody      | the client's own wallet            | the client, once handed over  |
 * | existing-identity | the client's wallet, for an identity it already has | whoever managed it |
 *
 * Every step is recorded in the onboarding record and the audit log. A step that fails on the
 * chain records why and leaves the record where it was, so it can be tried again.
 */

const now = () => new Date().toISOString();
const newId = () => `adm_${randomBytes(9).toString("base64url")}`;

export type NoteAccess = {
  status: "requested" | "approved" | "declined" | "revoked";
  requestedAt: string;
  answers: Answers;
  decidedAt?: string;
  decidedBy?: string;
  signature?: Hex;
  validUntil?: number;
  salt?: Hex;
  recordHash?: Hex;
  reason?: string;
};

/** The bank's admission of a wallet to the conversion pool (ADR 0090). */
export type PoolAccess = {
  status: "admitted" | "revoked";
  /** The investor class the bank found: the pool serves professional and institutional investors. */
  investorClass: (typeof POOL_CLASSES)[number];
  at: string;
  by: string;
  signature: Hex;
  validUntil: number;
  salt: Hex;
  recordHash: Hex;
  reason?: string;
};

/** The investor classes the pool serves (ADR 0033). */
export const POOL_CLASSES = ["professional", "institutional"] as const;

/** The client's answers on asking for the note: its selling restrictions, and its consent. */
export type Answers = {
  /** Not a U.S. person, and not acquiring for one: the note is sold under Regulation S. */
  notUsPerson: boolean;
  /** The investor class the client declares; the onboarding agent checks it against its own. */
  investorClass: string;
  /** Consent to the onboarding agent relying on the bank's KYB claim, rather than repeating it. */
  relyOnBankKyb: boolean;
};

export type Data = {
  request?: { organisation: string; requestedBy: string; knownReference?: string };
  kycReference?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  wallet?: Address;
  identity?: Address;
  custodian?: Custodian;
  clientRef?: string;
  challenge?: { typedData: Record<string, any>; expiresAt: number };
  signature?: Hex;
  deposit?: { signature: Hex; validUntil: number; recordHash: Hex; at: string; by: string };
  note?: NoteAccess;
  pool?: PoolAccess;
  revocations?: Array<{ topic: "deposit" | "note" | "pool"; by: string; at: string; reason: string }>;
  error?: string;
  offboarded?: { by: string; at: string; reason: string };
};

export const dataOf = (a: Admission) => a.data as Data;
/** The wallet an onboarding holds, once it has one. */
export const walletOf = (a: Admission) => (dataOf(a).wallet ?? "") as Address;
/** The custodian that acts for the wallet, for a custody account. */
export const custodianOf = (a: Admission): Custodian | null =>
  a.route === "bank-custody" ? "bank" : a.route === "third-party" ? "third-party" : null;

export const ROUTE_LABEL = LABELS as Record<AdmissionRoute, string>;

/** The routes a client may ask for from Onboard. */
export const CLIENT_ROUTES = ["bank-custody", "third-party", "self-custody"] as const;

export const CANCELLABLE: readonly Admission["status"][] = ["requested", "awaiting-wallet", "awaiting-custodian", "failed"];

function must(staff: Registrant, role: Role) {
  if (!hasRole(staff.email, role)) throw new Error("Not permitted.");
}

async function load(id: string): Promise<Admission> {
  const a = await getStore().admissionById(id);
  if (!a) throw new Error("No such onboarding.");
  return a;
}

/** Saves the next state, refusing if the record moved on meanwhile. */
async function save(a: Admission, from: Admission["status"], data: Data, status: Admission["status"] = a.status): Promise<Admission> {
  const next = { ...a, status, data: data as Record<string, unknown> };
  if (!(await getStore().updateAdmission(next, from))) throw new Error("The onboarding changed meanwhile; reload and try again.");
  return next;
}

async function audit(actor: string, action: string, subject: string) {
  await getStore().audit({ at: now(), actor, action, subject });
}

/** Runs a chain step; on failure records why on the onboarding, and rethrows. */
async function onChain<T>(a: Admission, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    const latest = await load(a.id);
    await getStore().updateAdmission({ ...latest, data: { ...latest.data, error: (e as Error).message } }, latest.status);
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------------------------

/** The client asks for a custody route; the bank confirms it against its KYB record. */
export async function requestRoute(client: Registrant, route: (typeof CLIENT_ROUTES)[number], knownReference?: string): Promise<Admission> {
  if (!CLIENT_ROUTES.includes(route)) throw new Error("Unknown route.");
  const open = (await getStore().listAdmissions(500)).find(
    (x) => x.registrantId === client.id && x.route === route && ["requested", "awaiting-wallet", "awaiting-custodian"].includes(x.status),
  );
  if (open) return open;
  const a: Admission = {
    id: newId(),
    registrantId: client.id,
    route,
    status: "requested",
    createdAt: now(),
    officerRequestId: null,
    walletRequestId: null,
    data: { request: { organisation: client.organisation, requestedBy: client.email, ...(knownReference?.trim() ? { knownReference: knownReference.trim() } : {}) } } satisfies Data,
  };
  await getStore().putAdmission(a);
  await audit(client.email, `asked for ${ROUTE_LABEL[route].toLowerCase()}`, a.id);
  return a;
}

export async function cancel(client: Registrant, id: string): Promise<void> {
  const a = await load(id);
  if (a.registrantId !== client.id || !CANCELLABLE.includes(a.status)) throw new Error("This onboarding cannot be cancelled.");
  await save(a, a.status, dataOf(a), "cancelled");
  await audit(client.email, "cancelled an onboarding", a.id);
}

/** How long a wallet message may be signed for. */
const WALLET_MESSAGE_SECONDS = 15 * 60;

/**
 * The message a self-custody client signs (Q4): its wallet, the hand-over, and its consent. It names
 * the site that asks, when it was issued and until when it may be signed, with a random nonce, as
 * Sign-In with Ethereum does (EIP-4361, ADR 0100): the wallet shows the site, and a message another
 * site shows is not this one.
 */
function walletMessage(a: Admission, wallet: Address, site: string) {
  const { m, s } = context();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + WALLET_MESSAGE_SECONDS;
  const typedData = {
    domain: { name: "Onboarding", version: "1", chainId: m.chainId },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      WalletControl: [
        { name: "wallet", type: "address" },
        { name: "onboarding", type: "string" },
        { name: "statement", type: "string" },
        { name: "consentTo", type: "address[]" },
        { name: "site", type: "string" },
        { name: "issuedAt", type: "uint256" },
        { name: "expiresAt", type: "uint256" },
        { name: "nonce", type: "string" },
      ],
    },
    primaryType: "WalletControl",
    message: {
      wallet,
      onboarding: a.id,
      statement:
        "I control this wallet. I ask the bank to create my identity, to record my consent to the bank and the onboarding agent vouching for me, and then to hand the identity's management to this wallet.",
      consentTo: [s.address("depositAgent"), s.address("accessIssuer")],
      site: site.replace(/\/+$/, ""),
      issuedAt: String(issuedAt),
      expiresAt: String(expiresAt),
      nonce: randomBytes(16).toString("hex"),
    },
  };
  return { typedData, expiresAt };
}

/**
 * The waiting message, checked: not expired, and signed by its wallet, by recovery or EIP-1271 for a
 * contract wallet. One check for both routes, so neither can skip the expiry (ADR 0100).
 */
async function checkWalletSignature(d: Data, signature: Hex): Promise<void> {
  if (!d.challenge || !d.wallet) throw new Error("There is no message waiting for a signature.");
  if (d.challenge.expiresAt < Math.floor(Date.now() / 1000)) throw new Error("The message has expired; connect the wallet again for a new one.");
  const { s } = context();
  const { EIP712Domain: _t, ...types } = d.challenge.typedData.types;
  const ok = await s.publicClient.verifyTypedData({ address: d.wallet, domain: d.challenge.typedData.domain, types, primaryType: "WalletControl", message: d.challenge.typedData.message, signature });
  if (!ok) throw new Error("The signature is not this wallet's.");
}

/** Self-custody: the message for the wallet the client connects. */
export async function startWallet(client: Registrant, id: string, wallet: string, site: string): Promise<Record<string, any>> {
  const a = await load(id);
  if (a.registrantId !== client.id) throw new Error("Not your onboarding.");
  if (a.status !== "awaiting-wallet") throw new Error("The bank has not confirmed this route yet.");
  if (!isAddress(wallet)) throw new Error("That is not a wallet address.");
  const w = getAddress(wallet);
  if (await identityOf(w)) throw new Error("That wallet already belongs to an identity.");
  const { typedData, expiresAt } = walletMessage(a, w, site);
  await save(a, a.status, { ...dataOf(a), wallet: w, challenge: { typedData, expiresAt }, error: undefined });
  return typedData;
}

/**
 * Self-custody: the signature arrives. Checked by recovery, or EIP-1271 for a contract wallet; the
 * bank then creates the identity, records the consent, vouches, and hands the identity over.
 */
export async function completeWallet(client: Registrant, id: string, signature: Hex): Promise<Admission> {
  const a = await load(id);
  const d = dataOf(a);
  if (a.registrantId !== client.id || a.status !== "awaiting-wallet") throw new Error("There is no message waiting for a signature.");
  await checkWalletSignature(d, signature);
  await save(a, a.status, { ...d, signature });
  await audit(client.email, `signed for wallet ${d.wallet}`, a.id);
  return establish(await load(id), "the client's signature");
}

/** The client asks for access to the note, with its answers. */
export async function requestNote(client: Registrant, id: string, answers: Answers): Promise<void> {
  const a = await load(id);
  const d = dataOf(a);
  if (a.registrantId !== client.id || a.status !== "onboarded") throw new Error("Onboard for the deposit first.");
  if (d.note && ["requested", "approved"].includes(d.note.status)) return;
  if (!answers.notUsPerson) throw new Error("The note is sold only outside the United States (Regulation S).");
  if (!answers.relyOnBankKyb) throw new Error("The onboarding agent relies on the bank's KYB; consent to it, or ask the onboarding agent to verify you itself.");
  await save(a, a.status, { ...d, note: { status: "requested", requestedAt: now(), answers } });
  await audit(client.email, "asked for access to the note", a.id);
}

/** An identity the client already has (Q2): the client names it and signs for its wallet. */
export async function requestExisting(client: Registrant, identity: string): Promise<Admission> {
  if (!isAddress(identity)) throw new Error("That is not an identity address.");
  if (!(await isIdentity(getAddress(identity)))) {
    throw new Error("That address is not an ONCHAINID identity: it is a wallet, or a contract of another kind. Give the address of the identity contract itself.");
  }
  const a: Admission = {
    id: newId(),
    registrantId: client.id,
    route: "existing-identity",
    status: "awaiting-wallet",
    createdAt: now(),
    officerRequestId: null,
    walletRequestId: null,
    data: { request: { organisation: client.organisation, requestedBy: client.email }, identity: getAddress(identity) } satisfies Data,
  };
  await getStore().putAdmission(a);
  await audit(client.email, `brought identity ${identity}`, a.id);
  return a;
}

/** An existing identity's wallet signature: checked, then the onboarding agent decides. */
export async function completeExisting(client: Registrant, id: string, signature: Hex): Promise<void> {
  const a = await load(id);
  const d = dataOf(a);
  if (a.registrantId !== client.id || a.route !== "existing-identity" || a.status !== "awaiting-wallet") throw new Error("There is no message waiting for a signature.");
  await checkWalletSignature(d, signature);
  await save(a, a.status, { ...d, signature }, "requested");
  await audit(client.email, `signed for wallet ${d.wallet}, for identity ${d.identity}`, a.id);
}

// ---------------------------------------------------------------------------------------------
// The bank
// ---------------------------------------------------------------------------------------------

async function activeClient(kycReference: string): Promise<Client> {
  if (!kycReference.trim()) throw new Error("Choose the client from the bank's records; add it under Clients if it is not there.");
  const c = await getStore().clientByReference(kycReference.trim());
  if (!c) throw new Error(`The bank has no client ${kycReference}.`);
  if (c.claims.status !== "active") throw new Error(`Client ${kycReference} is ${String(c.claims.status)}, not active.`);
  return c;
}

/** The bank confirms a route against its KYB record, and moves it on as the route needs. */
export async function confirmRoute(staff: Registrant, id: string, kycReference: string): Promise<Admission> {
  must(staff, "bank");
  const a = await load(id);
  if (a.status !== "requested" || a.route === "existing-identity") throw new Error("This onboarding is not waiting for the bank.");
  const c = await activeClient(kycReference);
  const d: Data = { ...dataOf(a), kycReference: c.kycReference, confirmedBy: staff.email, confirmedAt: now(), error: undefined };
  await audit(staff.email, `confirmed ${ROUTE_LABEL[a.route].toLowerCase()} for client ${c.kycReference}`, a.id);
  if (a.route === "self-custody") return save(a, a.status, d, "awaiting-wallet");
  if (a.route === "third-party") return save(a, a.status, { ...d, custodian: "third-party" }, "awaiting-custodian");
  // Bank custody: the custody platform opens the account at once.
  const next = await save(a, a.status, { ...d, custodian: "bank", clientRef: `${c.kycReference}/${a.id.slice(-6)}` }, "awaiting-custodian");
  return openForClient(staff, next.id, "bank");
}

export async function decline(staff: Registrant, id: string, reason: string): Promise<void> {
  must(staff, "bank");
  const a = await load(id);
  if (!["requested", "awaiting-wallet", "awaiting-custodian"].includes(a.status)) throw new Error("This onboarding cannot be declined.");
  await save(a, a.status, { ...dataOf(a), error: reason || undefined }, "declined");
  await audit(staff.email, `declined an onboarding${reason ? `: ${reason}` : ""}`, a.id);
}

/** The bank revokes its claim at once: the wallet can no longer hold or receive the deposit. */
export async function revokeDeposit(staff: Registrant, id: string, reason: string): Promise<void> {
  must(staff, "bank");
  if (!reason.trim()) throw new Error("Give the reason.");
  const a = await load(id);
  const d = dataOf(a);
  // The claim as the chain holds it: a wallet the deployment onboarded itself has no record here.
  const signature = d.deposit?.signature ?? (d.identity ? (await claimsOf(d.identity)).deposit.signature : null);
  if (!signature) throw new Error("The bank has not vouched for this wallet.");
  await onChain(a, () => revoke("deposit", signature));
  const latest = await load(id);
  await save(latest, latest.status, { ...dataOf(latest), revocations: [...(d.revocations ?? []), { topic: "deposit", by: staff.email, at: now(), reason }] });
  await audit(staff.email, `revoked the bank's claim for ${d.wallet}: ${reason}`, a.id);
}

/** The bank vouches again, against the client's current record: after a re-screen, or a revocation. */
export async function renewDeposit(staff: Registrant, id: string): Promise<void> {
  must(staff, "bank");
  const a = await load(id);
  const d = dataOf(a);
  if (a.status !== "onboarded" || !d.identity || !d.kycReference) throw new Error("This wallet is not onboarded.");
  const c = await activeClient(d.kycReference);
  const v = await onChain(a, () => vouch(d.identity!, "deposit", c.recordHash));
  const latest = await load(id);
  await save(latest, latest.status, { ...dataOf(latest), deposit: { ...v, recordHash: c.recordHash, at: now(), by: staff.email }, error: undefined });
  await audit(staff.email, `renewed the bank's claim for ${d.wallet}`, a.id);
}

/** The bank offboards a wallet: its claim revoked, and the wallet removed from every registry. */
export async function offboard(staff: Registrant, id: string, reason: string): Promise<void> {
  must(staff, "bank");
  if (!reason.trim()) throw new Error("Give the reason.");
  const a = await load(id);
  const d = dataOf(a);
  if (a.status !== "onboarded" || !d.wallet) throw new Error("This wallet is not onboarded.");
  await onChain(a, async () => {
    if (d.deposit) await revoke("deposit", d.deposit.signature);
    await unregister(d.wallet!);
  });
  const latest = await load(id);
  await save(latest, latest.status, { ...dataOf(latest), offboarded: { by: staff.email, at: now(), reason } }, "offboarded");
  await audit(staff.email, `offboarded ${d.wallet}: ${reason}`, a.id);
}

// ---------------------------------------------------------------------------------------------
// The custodians
// ---------------------------------------------------------------------------------------------

/**
 * The custodian opens the client's segregated account; its identity is created, managed by the
 * custodian, and the bank vouches for it. The bank's custody platform does this as soon as the
 * bank confirms; a third-party custodian does it from its own portal.
 */
export async function openForClient(staff: Registrant, id: string, which: Custodian): Promise<Admission> {
  if (!hasRole(staff.email, "custodian") && !(which === "bank" && hasRole(staff.email, "bank"))) throw new Error("Not permitted.");
  const a = await load(id);
  const d = dataOf(a);
  if (a.status !== "awaiting-custodian" || d.custodian !== which || !d.kycReference) throw new Error("This onboarding is not waiting for that custodian.");
  const clientRef = d.clientRef ?? `${d.kycReference}/${a.id.slice(-6)}`;
  const account = await onChain(a, () => openAccount(which, clientRef));
  await audit(staff.email, `opened custody account ${account} (${clientRef})`, a.id);
  await save(await load(id), "awaiting-custodian", { ...d, clientRef, wallet: account });
  return establish(await load(id), staff.email);
}

// ---------------------------------------------------------------------------------------------
// The onboarding agent
// ---------------------------------------------------------------------------------------------

/** The onboarding agent's own record of its decision: what its claim's hash is taken over. */
function noteRecord(a: Admission, note: NoteAccess, decidedAt: string, by: string) {
  const d = dataOf(a);
  return { onboarding: a.id, wallet: d.wallet, identity: d.identity, answers: note.answers, bankClaim: d.deposit?.signature ?? null, decidedAt, by };
}

export async function decideNote(staff: Registrant, id: string, outcome: "approve" | "decline", reason = ""): Promise<void> {
  must(staff, "onboarding");
  const a = await load(id);
  const d = dataOf(a);
  if (a.status !== "onboarded" || d.note?.status !== "requested" || !d.identity) throw new Error("There is no request for the note waiting.");
  const at = now();
  if (outcome === "decline") {
    await save(a, a.status, { ...d, note: { ...d.note, status: "declined", decidedAt: at, decidedBy: staff.email, reason } });
    await audit(staff.email, `declined access to the note${reason ? `: ${reason}` : ""}`, a.id);
    return;
  }
  if (d.note.answers.relyOnBankKyb && !(await eligibility(d.wallet!)).deposit) throw new Error("The bank's claim no longer stands; the client must be onboarded by the bank again.");
  const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
  const hash = recordHash(noteRecord(a, d.note, at, staff.email), salt);
  const v = await onChain(a, () => vouch(d.identity!, "note", hash));
  const latest = await load(id);
  const ld = dataOf(latest);
  await save(latest, latest.status, { ...ld, note: { ...ld.note!, status: "approved", decidedAt: at, decidedBy: staff.email, salt, recordHash: hash, ...v }, error: undefined });
  await audit(staff.email, `approved ${d.wallet} for the note`, a.id);
}

/** The onboarding agent revokes its claim at once: the wallet can no longer receive the note. */
export async function revokeNote(staff: Registrant, id: string, reason: string): Promise<void> {
  must(staff, "onboarding");
  if (!reason.trim()) throw new Error("Give the reason.");
  const a = await load(id);
  const d = dataOf(a);
  if (d.note?.status !== "approved" || !d.note.signature) throw new Error("The onboarding agent has not vouched for this wallet.");
  await onChain(a, () => revoke("note", d.note!.signature!));
  const latest = await load(id);
  const ld = dataOf(latest);
  await save(latest, latest.status, {
    ...ld,
    note: { ...ld.note!, status: "revoked", reason },
    revocations: [...(ld.revocations ?? []), { topic: "note", by: staff.email, at: now(), reason }],
  });
  await audit(staff.email, `revoked the note claim for ${d.wallet}: ${reason}`, a.id);
}

/**
 * The bank admits its client's wallet to the conversion pool (ADR 0090; plan, Q5): it has found the
 * client a professional or institutional investor, screened, and vouches for it with the
 * pool-access claim, which the pool's gate reads. The deposit must already accept the wallet, since
 * conversion moves the deposit; the client consented to the bank's claims when it was onboarded.
 */
export async function admitToPool(staff: Registrant, id: string, investorClass: string): Promise<void> {
  must(staff, "bank");
  const { m, s } = context();
  if (!m.venue) throw new Error("This deployment has no conversion pool.");
  const cls = POOL_CLASSES.find((c) => c === investorClass);
  if (!cls) throw new Error("The pool serves professional and institutional investors only.");
  const a = await load(id);
  const d = dataOf(a);
  if (a.status !== "onboarded" || !d.wallet || !d.identity) throw new Error("This wallet is not onboarded.");
  if (!(await eligibility(d.wallet)).deposit) throw new Error("The deposit does not accept this wallet: the bank's claim must stand first.");
  if (!(await consented(d.identity, s.address("depositAgent")))) throw new Error("The client has not consented to the bank vouching for it.");
  const at = now();
  const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
  const hash = recordHash({ onboarding: a.id, wallet: d.wallet, identity: d.identity, investorClass: cls, screened: true, decidedAt: at, by: staff.email }, salt);
  const v = await onChain(a, () => vouch(d.identity!, "pool", hash));
  const latest = await load(id);
  await save(latest, latest.status, { ...dataOf(latest), pool: { status: "admitted", investorClass: cls, at, by: staff.email, salt, recordHash: hash, ...v }, error: undefined });
  await audit(staff.email, `admitted ${d.wallet} to the conversion pool as ${cls}`, a.id);
}

/** The bank revokes its pool-access claim at once: the wallet can no longer convert. */
export async function revokePool(staff: Registrant, id: string, reason: string): Promise<void> {
  must(staff, "bank");
  if (!reason.trim()) throw new Error("Give the reason.");
  const a = await load(id);
  const d = dataOf(a);
  // The claim as the chain holds it: a wallet the deployment admitted itself has no record here.
  const signature = d.pool?.status === "admitted" ? d.pool.signature : d.identity ? (await claimsOf(d.identity)).pool.signature : null;
  if (!signature) throw new Error("The bank has not admitted this wallet to the pool.");
  await onChain(a, () => revoke("pool", signature));
  const latest = await load(id);
  const ld = dataOf(latest);
  await save(latest, latest.status, {
    ...ld,
    pool: ld.pool ? { ...ld.pool, status: "revoked", reason } : undefined,
    revocations: [...(ld.revocations ?? []), { topic: "pool", by: staff.email, at: now(), reason }],
  });
  await audit(staff.email, `revoked pool access for ${d.wallet}: ${reason}`, a.id);
}

/**
 * An identity brought from elsewhere (Q2): the onboarding agent registers the wallet against it,
 * relying on the claims it already carries. Refused, and the registration undone, if the note's
 * registry does not then verify it.
 */
export async function acceptExisting(staff: Registrant, id: string): Promise<void> {
  must(staff, "onboarding");
  const a = await load(id);
  const d = dataOf(a);
  if (a.route !== "existing-identity" || a.status !== "requested" || !d.wallet || !d.identity) throw new Error("This identity is not waiting for the onboarding agent.");
  // Not an identity: declined, and a registration made against it before this check is undone.
  if (!(await isIdentity(d.identity))) {
    if ((await identityOf(d.wallet))?.toLowerCase() === d.identity.toLowerCase()) await unregister(d.wallet);
    const latest = await load(id);
    await save(latest, latest.status, { ...dataOf(latest), error: "The address given is not an ONCHAINID identity." }, "declined");
    await audit(staff.email, `refused ${d.identity}: not an identity`, a.id);
    return;
  }
  await onChain(a, () => register(d.wallet!, d.identity!, "onboarding"));
  const ok = (await eligibility(d.wallet)).note;
  if (!ok) {
    await unregister(d.wallet);
    const latest = await load(id);
    await save(latest, latest.status, { ...dataOf(latest), error: "No issuer the note trusts vouches for this identity." }, "declined");
    await audit(staff.email, `refused identity ${d.identity}: no trusted claim for the note`, a.id);
    return;
  }
  const latest = await load(id);
  await save(latest, latest.status, { ...dataOf(latest), error: undefined }, "onboarded");
  await audit(staff.email, `registered ${d.wallet} against its existing identity ${d.identity}`, a.id);
}

// ---------------------------------------------------------------------------------------------
// Establishing the identity: the steps every route ends with
// ---------------------------------------------------------------------------------------------

/**
 * Creates the wallet's identity, managed by whoever holds the wallet's key, records the client's
 * consent to the bank and the onboarding agent, and has the bank vouch for the deposit. For
 * self-custody the bank manages the identity until it is handed over, as the last step.
 */
async function establish(a: Admission, actor: string): Promise<Admission> {
  const d = dataOf(a);
  const wallet = d.wallet!;
  const c = await activeClient(d.kycReference!);
  const { s } = context();
  const which = custodianOf(a);
  const manager = which ? custodianAddress(which) : s.address("depositAgent");
  const managerCapacity = which === "bank" ? "custodian" : which === "third-party" ? "thirdPartyCustodian" : "depositAgent";

  const identity = await onChain(a, () => createIdentity(wallet, manager, `${a.id}`));
  const withIdentity = await load(a.id);
  await save(withIdentity, withIdentity.status, { ...dataOf(withIdentity), identity });
  await onChain(a, async () => {
    await consent(identity, managerCapacity, s.address("depositAgent"));
    await consent(identity, managerCapacity, s.address("accessIssuer"));
  });
  const v = await onChain(a, () => vouch(identity, "deposit", c.recordHash));
  if (a.route === "self-custody") await onChain(a, () => handOver(identity, wallet));

  const latest = await load(a.id);
  const done = await save(
    latest,
    latest.status,
    { ...dataOf(latest), identity, deposit: { ...v, recordHash: c.recordHash, at: now(), by: actor }, challenge: undefined, error: undefined },
    "onboarded",
  );
  await audit(actor, `onboarded ${wallet} for the deposit, identity ${identity}${a.route === "self-custody" ? ", handed to the client" : ""}`, a.id);
  return done;
}

/** The existing-identity route's message: the same wallet-control message, without a hand-over. */
export async function startExistingWallet(client: Registrant, id: string, wallet: string, site: string): Promise<Record<string, any>> {
  const a = await load(id);
  if (a.registrantId !== client.id || a.route !== "existing-identity" || a.status !== "awaiting-wallet") throw new Error("This identity is not waiting for a wallet.");
  if (!isAddress(wallet)) throw new Error("That is not a wallet address.");
  const w = getAddress(wallet);
  if (w === dataOf(a).identity) throw new Error("A wallet cannot be its own identity: connect the wallet the identity is for.");
  const { typedData, expiresAt } = walletMessage(a, w, site);
  typedData.message.statement = `I control this wallet, and ask for it to be registered against my identity ${dataOf(a).identity}.`;
  await save(a, a.status, { ...dataOf(a), wallet: w, challenge: { typedData, expiresAt } });
  return typedData;
}

/** Placement and the Ledger read the custody account a custodian opened for a client reference. */
export { accountFor };
