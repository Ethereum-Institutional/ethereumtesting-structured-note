/**
 * Onboarding by role, end to end against the local chain (ADRs 0088 to 0090): every custody route,
 * the note's request and the onboarding agent's decision, admission to the conversion pool,
 * revocation and renewal by each claim's own issuer, offboarding, and an identity brought from
 * elsewhere. The site's own code runs
 * unchanged, through a proxy that answers reads from a block behind just after a receipt, as a
 * load-balanced public RPC does; every outcome is read back from the chain.
 *
 *   ../ops/reset.sh && npm run test:admission
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { startLaggingRpc } from "./lagging-rpc.ts";

const REPO = join(import.meta.dirname, "..", "..");
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const lagging = await startLaggingRpc(4041, RPC);
after(() => lagging.close());

process.chdir(mkdtempSync(join(tmpdir(), "onboarding-"))); // a fresh development store
Object.assign(process.env, {
  NODE_ENV: "development",
  MANIFEST_PATH: join(REPO, "ops", "addresses.json"),
  RPC_URL: lagging.url,
  OPERATOR_EMAILS: "operator@example.org",
  BANK_EMAILS: "banker@bank.example",
  ONBOARDING_EMAILS: "",
  AGENT_EMAILS: "",
  CUSTODIAN_EMAILS: "",
});
const { getStore } = await import("../lib/store.ts");
const clients = await import("../lib/identity/clients.ts");
const onboarding = await import("../lib/identity/onboarding.ts");
const { loadManifest } = await import("../lib/chain/manifest.ts");
const store = getStore();
const m = loadManifest();
const chain = createPublicClient({ transport: http(RPC) });

const person = (id: string, email: string, organisation: string) => ({ id, email, name: id, organisation, status: "approved" as const, createdAt: new Date().toISOString(), verifiedAt: null, decidedAt: null, decidedBy: null });
const operator = person("reg_operator", "operator@example.org", "The Bank");
const banker = person("reg_banker", "banker@bank.example", "The Bank");
for (const r of [operator, banker]) await store.createRegistrant(r);

const REGISTRY = parseAbi(["function isVerified(address) view returns (bool)", "function identity(address) view returns (address)"]);
const IDENTITY = parseAbi(["function keyHasPurpose(bytes32 key, uint256 purpose) view returns (bool)"]);
const keyOf = (a: Address) => keccak256(encodeAbiParameters([{ type: "address" }], [a]));
const verified = (registry: Address, wallet: Address) => chain.readContract({ address: registry, abi: REGISTRY, functionName: "isVerified", args: [wallet] });
const forDeposit = (w: Address) => verified(m.identity!.depositRegistry, w);
const forNote = (w: Address) => verified(m.noteSuite!.identityRegistry, w);
const manages = (identity: Address, who: Address) => chain.readContract({ address: identity, abi: IDENTITY, functionName: "keyHasPurpose", args: [keyOf(who), 1n] });

/** A corporate client of the bank, and a registrant who speaks for it. */
async function aClient(n: number) {
  const c = await clients.addClient(banker as any, {
    legalName: `Onboarding Test ${n} SA`,
    legalForm: "PLC",
    registrationNumber: `B${n}${Date.now()}`,
    jurisdiction: "LU",
    incorporationDate: "2015-03-01",
    status: "active",
  });
  const r = person(`reg_client_${n}`, `client${n}@corp${n}.example`, `Onboarding Test ${n} SA`);
  await store.createRegistrant(r);
  return { c, r };
}

/** The client's own wallet signs the message the bank prepared for it. */
async function signFor(key: Hex, typedData: Record<string, any>): Promise<Hex> {
  const { EIP712Domain: _t, ...types } = typedData.types;
  return privateKeyToAccount(key).signTypedData({ domain: typedData.domain, types, primaryType: typedData.primaryType, message: typedData.message });
}

const SITE = "http://localhost:3020";

const ANSWERS = { notUsPerson: true, investorClass: "institutional", relyOnBankKyb: true };

test("bank custody: confirmed by the bank, the custody platform opens the account, manages its identity, and the bank vouches", async () => {
  const { c, r } = await aClient(1);
  let a = await onboarding.requestRoute(r as any, "bank-custody");
  assert.equal(a.status, "requested");
  await assert.rejects(onboarding.confirmRoute(r as any, a.id, c.kycReference), /Not permitted/);
  a = await onboarding.confirmRoute(banker as any, a.id, c.kycReference);
  assert.equal(a.status, "onboarded", String((a.data as any).error));
  const d = onboarding.dataOf(a);
  assert.ok(d.wallet && d.identity);
  assert.equal(await forDeposit(d.wallet!), true, "the deposit accepts the account");
  assert.equal(await forNote(d.wallet!), false, "not the note, before the onboarding agent vouches");
  assert.equal(await manages(d.identity!, m.parties.custodian as Address), true, "the custody platform manages the identity");
  assert.equal(await manages(d.identity!, m.parties.depositAgent as Address), false, "the bank does not");
  assert.equal(d.deposit?.recordHash, c.recordHash, "the bank's claim carries its record's hash");

  // The note: asked for, then approved by the onboarding agent.
  await assert.rejects(onboarding.requestNote(r as any, a.id, { ...ANSWERS, notUsPerson: false }), /Regulation S/);
  await onboarding.requestNote(r as any, a.id, ANSWERS);
  await assert.rejects(onboarding.decideNote(banker as any, a.id, "approve"), /Not permitted/, "the bank does not vouch for the note");
  await onboarding.decideNote(operator as any, a.id, "approve");
  assert.equal(await forNote(d.wallet!), true, "the note accepts the account");
});

let selfCustody: { wallet: Address; key: Hex; identity: Address; id: string };

test("self-custody: the client signs once, the bank sets the identity up and hands it over", async () => {
  const { c, r } = await aClient(2);
  let a = await onboarding.requestRoute(r as any, "self-custody");
  a = await onboarding.confirmRoute(banker as any, a.id, c.kycReference);
  assert.equal(a.status, "awaiting-wallet");

  const key = generatePrivateKey();
  const wallet = privateKeyToAccount(key).address;
  const typedData = await onboarding.startWallet(r as any, a.id, wallet, SITE);
  // A signature by another key is refused, and nothing changes.
  await assert.rejects(onboarding.completeWallet(r as any, a.id, await signFor(generatePrivateKey(), typedData)), /not this wallet's/);
  a = await onboarding.completeWallet(r as any, a.id, await signFor(key, typedData));
  assert.equal(a.status, "onboarded", String((a.data as any).error));
  const identity = onboarding.dataOf(a).identity!;
  assert.equal(await forDeposit(wallet), true);
  assert.equal(await manages(identity, wallet), true, "the client's wallet manages its identity");
  assert.equal(await manages(identity, m.parties.depositAgent as Address), false, "the bank has handed it over");
  selfCustody = { wallet, key, identity, id: a.id };
});

test("third-party custodian: the bank confirms, the custodian opens the account and manages the identity", async () => {
  const { c, r } = await aClient(3);
  let a = await onboarding.requestRoute(r as any, "third-party");
  a = await onboarding.confirmRoute(banker as any, a.id, c.kycReference);
  assert.equal(a.status, "awaiting-custodian");
  await assert.rejects(onboarding.openForClient(banker as any, a.id, "third-party"), /Not permitted/, "the bank does not open a third party's accounts");
  a = await onboarding.openForClient(operator as any, a.id, "third-party");
  assert.equal(a.status, "onboarded", String((a.data as any).error));
  const d = onboarding.dataOf(a);
  assert.equal(await forDeposit(d.wallet!), true);
  assert.equal(await manages(d.identity!, m.parties.thirdPartyCustodian as Address), true, "the third-party custodian manages the identity");
});

test("each institution revokes its own claim at once, and the bank renews its own", async () => {
  const { wallet, id } = selfCustody;
  await onboarding.requestNote({ id: (await store.admissionById(id))!.registrantId } as any, id, ANSWERS);
  await onboarding.decideNote(operator as any, id, "approve");
  assert.equal(await forNote(wallet), true);

  await assert.rejects(onboarding.revokeDeposit(banker as any, id, ""), /reason/);
  await onboarding.revokeDeposit(banker as any, id, "Screening hit under review");
  assert.equal(await forDeposit(wallet), false, "the deposit refuses it at once");
  assert.equal(await forNote(wallet), true, "the note's claim is the onboarding agent's, untouched");

  await onboarding.renewDeposit(banker as any, id);
  assert.equal(await forDeposit(wallet), true, "a fresh claim restores it");

  await onboarding.revokeNote(operator as any, id, "Investor class withdrawn");
  assert.equal(await forNote(wallet), false);
});

test("an identity brought from elsewhere is registered for the note only if a trusted issuer vouches for it", async () => {
  // The self-custody client's identity carries a note claim: approve it again, then bring the
  // identity with a new wallet, signed for by that wallet.
  const { identity, id } = selfCustody;
  const owner = (await store.admissionById(id))!.registrantId;
  const latest = (await store.admissionById(id))!;
  await store.updateAdmission({ ...latest, data: { ...latest.data, note: { ...(latest.data as any).note, status: "requested" } } }, latest.status);
  await onboarding.decideNote(operator as any, id, "approve");

  const r = { ...(await store.registrantById(owner))! };
  const key = generatePrivateKey();
  const wallet = privateKeyToAccount(key).address;
  let a = await onboarding.requestExisting(r, identity);
  const typedData = await onboarding.startExistingWallet(r, a.id, wallet, SITE);
  // The message names the site that asks, when, and a nonce; past its expiry it is refused on this
  // route too (ADR 0100).
  assert.equal(typedData.message.site, SITE);
  assert.ok(Number(typedData.message.issuedAt) < Number(typedData.message.expiresAt));
  assert.match(typedData.message.nonce, /^[0-9a-f]{32}$/);
  const waiting = (await store.admissionById(a.id))!;
  await store.updateAdmission({ ...waiting, data: { ...waiting.data, challenge: { ...(waiting.data as any).challenge, expiresAt: 1 } } }, waiting.status);
  await assert.rejects(onboarding.completeExisting(r, a.id, await signFor(key, typedData)), /expired/);
  await store.updateAdmission(waiting, waiting.status);
  await onboarding.completeExisting(r, a.id, await signFor(key, typedData));
  a = (await store.admissionById(a.id))!;
  assert.equal(a.status, "requested");
  await assert.rejects(onboarding.acceptExisting(banker as any, a.id), /Not permitted/);
  await onboarding.acceptExisting(operator as any, a.id);
  a = (await store.admissionById(a.id))!;
  assert.equal(a.status, "onboarded", String((a.data as any).error));
  assert.equal(await forNote(wallet), true, "the claim the identity carries serves the new wallet");
  const registered = await chain.readContract({ address: m.identity!.depositRegistry, abi: REGISTRY, functionName: "identity", args: [wallet] });
  assert.equal(registered.toLowerCase(), identity.toLowerCase());

  // An identity no trusted issuer vouches for, for the note, is refused and left unregistered.
  const { c: c4, r: r4 } = await aClient(4);
  let b = await onboarding.requestRoute(r4 as any, "bank-custody");
  b = await onboarding.confirmRoute(banker as any, b.id, c4.kycReference);
  const bare = onboarding.dataOf(b).identity!;
  const otherKey = generatePrivateKey();
  const other = privateKeyToAccount(otherKey).address;
  let e = await onboarding.requestExisting(r4 as any, bare);
  await onboarding.completeExisting(r4 as any, e.id, await signFor(otherKey, await onboarding.startExistingWallet(r4 as any, e.id, other, SITE)));
  await onboarding.acceptExisting(operator as any, e.id);
  e = (await store.admissionById(e.id))!;
  assert.equal(e.status, "declined");
  const none = await chain.readContract({ address: m.identity!.depositRegistry, abi: REGISTRY, functionName: "identity", args: [other] });
  assert.match(none, /^0x0{40}$/i, "the registration is undone");

  // A wallet's address given as the identity is refused at once: it is not an ONCHAINID identity.
  const eoaKey = generatePrivateKey();
  const eoa = privateKeyToAccount(eoaKey).address;
  await assert.rejects(onboarding.requestExisting(r4 as any, eoa), /not an ONCHAINID identity/);
  // One accepted before that check, with the wallet registered against it, is declined when accepted
  // again, and the registration undone; the wallet's eligibility reads as none, not as an error.
  let f = await onboarding.requestExisting(r4 as any, bare);
  await onboarding.completeExisting(r4 as any, f.id, await signFor(eoaKey, await onboarding.startExistingWallet(r4 as any, f.id, eoa, SITE)));
  f = (await store.admissionById(f.id))!;
  await store.updateAdmission({ ...f, data: { ...f.data, identity: eoa } }, f.status);
  const onchain = await import("../lib/identity/onchain.ts");
  await onchain.register(eoa, eoa, "onboarding");
  assert.deepEqual(await onchain.eligibility(eoa), { deposit: false, note: false, pool: false });
  await onboarding.acceptExisting(operator as any, f.id);
  f = (await store.admissionById(f.id))!;
  assert.equal(f.status, "declined");
  assert.match((f.data as any).error, /not an ONCHAINID identity/);
  const undone = await chain.readContract({ address: m.identity!.depositRegistry, abi: REGISTRY, functionName: "identity", args: [eoa] });
  assert.match(undone, /^0x0{40}$/i, "the bad registration is undone");
});

test("a client asks to close its account: refused while it holds the deposit; asked, withdrawn and asked again; the bank closes it, and the wallet is in no registry (ADR 0107)", async () => {
  const closing = await import("../lib/identity/closing.ts");
  const deposit = await import("../lib/identity/deposit.ts");
  const { c, r } = await aClient(5);
  let a = await onboarding.requestRoute(r as any, "self-custody");
  a = await onboarding.confirmRoute(banker as any, a.id, c.kycReference);
  const key = generatePrivateKey();
  const wallet = privateKeyToAccount(key).address;
  a = await onboarding.completeWallet(r as any, a.id, await signFor(key, await onboarding.startWallet(r as any, a.id, wallet, SITE)));
  assert.equal(a.status, "onboarded", String((a.data as any).error));

  // Holding the deposit: refused, and the refusal says what is held.
  await deposit.creditDeposit(wallet, 1_000n);
  // Read as the site reads, through an RPC a block behind: wait until it shows the credit.
  const seen = async (want: boolean) => { for (let i = 0; i < 30 && (await closing.stillHeld(wallet)).length > 0 !== want; i++) await new Promise((r) => setTimeout(r, 500)); };
  await seen(true);
  await assert.rejects(closing.requestClose(r as any, a.id, "Moving banks"), /cannot close while it holds or is owed anything: .* of the deposit/);
  await assert.rejects(closing.requestClose(operator as any, a.id, "Not mine"), /Not your account/);
  await deposit.debitDeposit(wallet, 1_000n);
  await seen(false);
  assert.deepEqual(await closing.stillHeld(wallet), []);

  // Asked, withdrawn, asked again; only the bank's staff may close it.
  await assert.rejects(closing.requestClose(r as any, a.id, "  "), /Give the reason/);
  await closing.requestClose(r as any, a.id, "Moving banks");
  assert.equal((onboarding.dataOf((await store.admissionById(a.id))!) as any).closeRequest.reason, "Moving banks");
  await closing.withdrawClose(r as any, a.id);
  assert.equal((onboarding.dataOf((await store.admissionById(a.id))!) as any).closeRequest, undefined);
  await assert.rejects(closing.confirmClose(banker as any, a.id), /has not asked to close/);
  await closing.requestClose(r as any, a.id, "Moving banks");
  await assert.rejects(closing.confirmClose(r as any, a.id), /Not permitted/);
  await closing.confirmClose(banker as any, a.id);
  const closed = (await store.admissionById(a.id))!;
  assert.equal(closed.status, "offboarded");
  assert.match((onboarding.dataOf(closed) as any).offboarded.reason, /Closed at the client's request: Moving banks/);
  assert.equal(await forDeposit(wallet), false);
  const gone = await chain.readContract({ address: m.identity!.depositRegistry, abi: REGISTRY, functionName: "identity", args: [wallet] });
  assert.match(gone, /^0x0{40}$/i, "in no registry");
});

test("the bank removes a client to add it again: refused while an account for it is onboarded; an onboarding in progress returns to the bank and is confirmed against the client added again (ADR 0108)", async () => {
  // The self-custody client of the earlier test is onboarded on the chain: its record stays.
  const onboarded = (await store.admissionById(selfCustody.id))!;
  const ref = onboarding.dataOf(onboarded).kycReference!;
  const held = (await store.clientByReference(ref))!;
  await assert.rejects(clients.removeClient(banker as any, held.id, "Wrong jurisdiction"), /onboarded on the chain .* Offboard it under Onboarding first/);
  await assert.rejects(clients.removeClient(operator as any, held.id, "  "), /Give the reason/);
  assert.ok(await store.clientByReference(ref), "kept");

  // A client whose onboarding is in progress: removed, the onboarding goes back to the bank.
  const { c, r } = await aClient(6);
  let a = await onboarding.requestRoute(r as any, "self-custody");
  a = await onboarding.confirmRoute(banker as any, a.id, c.kycReference);
  assert.equal(a.status, "awaiting-wallet");
  await assert.rejects(clients.removeClient(r as any, c.id, "Typo"), /Not permitted/);
  assert.deepEqual(await clients.removeClient(banker as any, c.id, "Legal name misspelt"), { returned: 1 });
  assert.equal(await store.clientByReference(c.kycReference), null);
  a = (await store.admissionById(a.id))!;
  assert.equal(a.status, "requested");
  assert.equal(onboarding.dataOf(a).kycReference, undefined);
  // Added again, put right, and the same request confirmed against it.
  const again = await clients.addClient(banker as any, { legalName: "Onboarding Test 6 SA", legalForm: "PLC", registrationNumber: `B6R${Date.now()}`, jurisdiction: "LU", incorporationDate: "2015-03-01", status: "active" });
  a = await onboarding.confirmRoute(banker as any, a.id, again.kycReference);
  assert.equal(a.status, "awaiting-wallet");
  assert.match((await store.auditLog(50)).map((e) => e.action).join("\n"), /removed client .* Legal name misspelt; 1 onboarding returned to the bank/);
});

test("offboarding revokes the bank's claim and removes the wallet from every registry", async () => {
  const { wallet, id } = selfCustody;
  await onboarding.offboard(banker as any, id, "Relationship ended");
  assert.equal((await store.admissionById(id))!.status, "offboarded");
  assert.equal(await forDeposit(wallet), false);
  const gone = await chain.readContract({ address: m.identity!.depositRegistry, abi: REGISTRY, functionName: "identity", args: [wallet] });
  assert.match(gone, /^0x0{40}$/i);
});

test("the bank admits an account to the pool and revokes it; the custody platform converts in between", { skip: !m.venue && "no pool on this deployment" }, async () => {
  const { poolStanding } = await import("../lib/identity/onchain.ts");
  const { creditDeposit } = await import("../lib/identity/deposit.ts");
  const { convertForCustody, balances } = await import("../lib/pool/convert.ts");
  const { c, r } = await aClient(6);
  let a = await onboarding.requestRoute(r as any, "bank-custody");
  a = await onboarding.confirmRoute(banker as any, a.id, c.kycReference);
  const account = onboarding.walletOf(a);
  assert.equal(await poolStanding(account), "no valid pool-access claim", "the deposit accepts it; the pool does not, yet");

  await assert.rejects(onboarding.admitToPool(r as any, a.id, "institutional"), /Not permitted/, "the client does not admit itself");
  await assert.rejects(onboarding.admitToPool(banker as any, a.id, "retail"), /professional and institutional/);
  await onboarding.admitToPool(banker as any, a.id, "institutional");
  assert.equal(await poolStanding(account), "admitted");
  const pool = onboarding.dataOf((await store.admissionById(a.id))!).pool!;
  assert.equal(pool.investorClass, "institutional");
  const chainNow = Number((await chain.getBlock()).timestamp);
  assert.ok(pool.validUntil - chainNow <= 90 * 86_400, "the pool's claim runs at most 90 days, by the chain's clock");

  // Admitted, the custody platform converts the client's deposit, with the account's approvals in the same batch.
  await creditDeposit(account, 1_000_00n);
  await convertForCustody(account, "into-payment", 500_00n);
  const { until } = await import("../lib/chain/until.ts");
  assert.ok((await until(() => balances(account), (h) => h.payment > 0n)).payment > 0n, "the account received the payment token");

  await onboarding.revokePool(banker as any, a.id, "Screening alert");
  assert.equal(await poolStanding(account), "no valid pool-access claim", "revoked at once");
  await assert.rejects(convertForCustody(account, "into-payment", 100_00n), "the pool refuses it");
  assert.equal(await forDeposit(account), true, "the deposit still accepts it");
});

test("the bank's records: facts kept off-chain, a salted hash per screening", async () => {
  const { c } = await aClient(5);
  const again = await clients.rescreenClient(banker as any, c.id);
  assert.notEqual(again.recordHash, c.recordHash, "a fresh salt each screening");
  assert.equal(again.previous.at(-1)?.recordHash, c.recordHash);
  const { recordHash } = await import("../lib/identity/onchain.ts");
  assert.equal(recordHash(clients.recordOf(again), again.salt), again.recordHash, "anyone shown the record and salt can check the hash");
  await assert.rejects(clients.addClient(operator as any, { legalName: "", legalForm: "PLC", registrationNumber: "x", jurisdiction: "LU", incorporationDate: "2015-03-01", status: "active" }), /legal name/);
});
