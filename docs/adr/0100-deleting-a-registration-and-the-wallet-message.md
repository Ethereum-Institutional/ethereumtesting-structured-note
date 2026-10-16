# 0100. An admin may delete a registration; the wallet message names its site and expires on every route

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

**Removing someone.** Staff could approve, decline, revoke and reinstate a registration (ADRs 0077,
0093), but not remove one. A test sign-up, a mistaken address or someone who has left stayed on the
list for good. Their address could never register afresh.

**The wallet message.** A client proves control of a wallet by signing a typed message, on two
routes: self-custody, and bringing an existing identity (ADR 0089). A review of that message found:
- **Replay is already prevented.** The message names its onboarding and its wallet, and its domain names the chain. The site checks a signature only against the message it stored for that onboarding, and only while the onboarding is waiting for one, so a signature counts once.
- **The existing-identity route never checked the expiry.** A message older than its stated 15 minutes was still accepted there. It was still single-use, but "valid for 15 minutes" was not true on that route.
- **The message did not name the site that asked.** A message shown by another site would look the same in the wallet.

## Decision

**An admin may delete a registration.** The owner chose both options below.

| Question | Options | Chosen |
|---|---|---|
| Who may delete | The staff in `OPERATOR_EMAILS`, who already hold every portal; or a new `ADMIN_EMAILS` list | **`OPERATOR_EMAILS`.** Staff with a single portal may still approve, decline and revoke, but not delete |
| What a deletion removes | Off-chain records, refused while the person has an identity on the chain; off-chain records always; or the login only | **Off-chain records, refused while there is an identity on the chain** |

**What a deletion removes:** the registration, its sign-in codes, its sessions and its onboarding
requests, in one transaction. The address may then register afresh. The audit log keeps an entry
saying who deleted whom.

**When a deletion is refused:**
- while any wallet onboarded for the person holds an identity on the chain in this deployment, since the chain cannot be erased from here. The bank offboards the wallet first;
- for an admin's own registration.

**Where it is done.** On the Sign-ups page, from a "Delete…" control shown to admins only. The
control explains what is removed and refuses in words.

**The wallet message, as Sign-In with Ethereum (EIP-4361) does.** The message now carries:
- the site's own address;
- the time it was issued;
- its expiry, as before;
- a random nonce.

The wallet shows the site, so a message shown by another site differs from ours. A single check,
of the expiry and then the signature, now serves both routes, so neither can skip the expiry.

## Consequences

**What stays.** Bank records of clients (KYB) are the bank's, not the registration's, and stay.
Identities and claims on the chain also stay. Older deployments' onboarding records for the person
are removed with the rest: they are history the chain still holds.

**Tests:**
- **Browser spec 01:** the bank's own staff are not offered deletion; the admin deletes a declined sign-up, which leaves the list, and the audit log records the deletion.
- **Browser spec 03:** deleting the self-custody client, whose wallet holds an identity, is refused in words, and the client stays.
- **Integration:** the message names the site, carries an issued-at time and a nonce, and is refused past its expiry on the existing-identity route.

**The retired links table.** The production database still held `links`, the one-time sign-in links
that ADR 0093 retired. Its rows referred to registrations, so the first deletion there failed on
the foreign key. The browser tests use the file store, which never had the table, so they did not
catch it. The site now drops `links` when it applies its schema. A database as production had it
was rebuilt locally in Postgres and the deletion run against it: it succeeds, and the table is
gone.
