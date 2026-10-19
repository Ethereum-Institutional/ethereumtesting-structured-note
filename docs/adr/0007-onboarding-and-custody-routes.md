# 0007. Onboarding and custody routes

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

A client comes to the notes through the bank, which already knows it from its KYB. Most clients
want the bank or a custodian to hold their assets; some hold their own wallet; a few already have
an identity elsewhere. The client's facts must stay with the bank, and every route must end in the
same thing: a wallet registered against an identity carrying the claims of record 0005.

## Decision

**The bank's client record.** Bank staff enter a corporate client's facts once, on Bank → Clients.
The record stays in the site's database, in the bank's portal, with a random salt; only its salted
hash reaches the chain, in the bank's claim. The site assigns the client reference (`CLI-…`).
Re-screening keeps the earlier record's hash. The bank may remove a client, with a reason, while
no account for it is onboarded on the chain.

**Four routes:**

| Route | The wallet | Who manages the identity |
|---|---|---|
| Bank custody | A segregated custody account at the bank's custody platform | The custody platform |
| Third-party custodian | A segregated custody account at a third-party custodian, opened in its own portal | The custodian |
| Self-custody | The client's own wallet | The client, once the bank hands it over |
| Existing identity | The client's wallet, for an ONCHAINID identity it already has | Whoever already manages it |

**The journey:**
1. The client registers and is approved (record 0020).
2. It chooses a route; the bank confirms it against its client record.
3. The account's wallet is established: the custodian opens a custody account, or the client
   binds its own wallet with one signature.
4. The bank creates the identity, records the client's consent, registers the wallet, and adds
   its deposit claim. The wallet may hold the deposit at once.
5. The client asks for the notes, answering the selling-restriction questions once; the
   onboarding agent sees the bank's claim stands and adds the note claim.
6. Where the client asks, the bank admits it to the conversion pool with its pool-access claim.

**Custody accounts.** Each custodian has a `CustodyAccountFactory` that deploys one
`CustodyAccount` per client at a deterministic address (CREATE2 on the account's reference), so
the address is known before the account exists. The reference is `SEG-` and twelve characters of a
hash of the bank's client reference and the onboarding's own random identifier: it reaches the
chain in the factory's call, so it must not reveal the client, and the mapping lives only in the
site's records. The custodian alone executes through it, in batches,
each call attributed on-chain to that client; the account signs by EIP-1271 against the
custodian's key. Assets are never commingled.

**Binding a self-held wallet.** One EIP-712 message, signed in the browser wallet, states the
wallet, the hand-over of the identity's management, and the client's consent to the bank and the
onboarding agent vouching for it. As Sign-In with Ethereum does, it names the site, when it was
issued, when it expires (15 minutes) and a random nonce. It is checked by recovery, or by EIP-1271
for a contract wallet. The bank then makes the wallet the identity's manager and removes itself.
The client signs once and pays nothing.

**Ending an account:**
- A client may cancel an onboarding until it is on the chain.
- A client asks to close an account, with a reason; the bank closes it through its offboarding.
  Refused while the account holds the deposit or any note, has units locked in an offer, is owed a
  held amount, or is a holder of record for an unpaid distribution; checked again when the bank
  closes.
- The bank offboards an account, with a reason: its claim revoked and its wallet removed from the
  storage.
- Each institution revokes its own claim, at once, in its own portal.

**A brought identity.** On the existing-identity route the onboarding agent decides; the bank's key
then registers the wallet in the shared identity storage through the deposit's registry, as its
registrar. No note's registry has agents of its own, and every note reads the same storage.

**Naming.** An account is named by the bank's client it was confirmed against, by legal name; until
then, and on the existing-identity route, by the requester's organisation.

## Consequences

- The common case costs the client nothing: the custodian acts, and the client signs nothing on
  the chain.
- A custody account is a holder of record in its own right, so one client can be frozen, paid or
  corrected without touching another.
- A custody account's reference is opaque on the chain: nobody reading the factory's call or event
  learns which of the bank's clients it belongs to.
