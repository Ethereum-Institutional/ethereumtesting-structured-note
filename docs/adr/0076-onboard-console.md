# 0076. The client's Onboard pages: a navigation column, an account card, unbinding, and asking for custody

- **Status:** Accepted (owner, 1 October 2026)
- **Date:** 1 October 2026

## Context

The Onboard page had grown into one long column: progress, a request, a table of the onboarded
wallet, converting, binding a new wallet. "Bind a new wallet" sat apart from the wallet it
replaces. A client could not leave the pool by itself, or move back to being held by its bank.

## Options

1. **Unbinding:**
   - (a) immediately, by the client, as staff offboarding does;
   - (b) a request the bank acts on.
2. **Back to custodial:**
   - (a) the client asks, staff admit the custody account;
   - (b) the client's click opens and admits it.
   
   (b) would have the custodian act with no staff instruction, against ADR 0067.

## Decision

1(a), 2(a), chosen by the owner.
- **Pages.** Onboard has a navigation column like the Operator console (ADR 0073):
  - **Account** (`/onboard`);
  - **Convert** (`/onboard/convert`);
  - **Notes** (`/onboard/notes`), with the number of offers waiting.
- **The account card.** The onboarded account shows as a card: its address, when it was onboarded,
  how long its grant runs, and whether it is approved for the notes. Its actions sit beneath it:
  - **Bind a new wallet**;
  - **Ask my bank to hold it in custody**, or withdraw that request;
  - **Unbind this wallet…**, with a warning and a confirmation.
  
  The progress stages show only while onboarding. Earlier wallets fold away beneath.
- **Unbinding.** The client's own act. Both grants are revoked at once, the reason recorded as
  "unbound by the client". The KYB stands, so binding again needs only a signature.
- **Asking for custody.** This is open to a client whose bank confirmed its KYB here.
  - The request is kept on the bank's client record. It is listed first on Operator → Custody → Custodial, and counted in the navigation; staff admit it there in one click.
  - Admitting the custody account answers the request. One wallet per KYB (ADR 0069) then unbinds the client's own wallet.
  - The client's Account page shows the custody account the bank holds for it. From there the client can bind a wallet of its own again.

## Consequences

- A client's own wallet keeps whatever it holds when unbound or replaced, but can no longer
  convert or receive or move the deposit or the note.
- Moving those holdings to a custody account is the bank's matter, outside the site.
- Holder-wallet clients have no bank KYB here, so they cannot ask for custody from the page;
  they ask the bank directly.
