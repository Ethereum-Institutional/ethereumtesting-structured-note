# Architecture decision records

These records describe the structured note programme as it stands in the code today: what the
system is, the decisions that shape it, why each option was chosen, and what follows from it. They
are current, not historical: when the design changes, the record changes with it, and where a
record and the code disagree, the code is right and the record is corrected. They are for the
codebase only; nothing a user sees cites them. Read 0001 first, then the contracts (0002 to 0019),
then the site (0020 to 0026), and testing (0027).

| # | Title | In one line |
|---|---|---|
| [0001](0001-purpose-audience-and-these-records.md) | Purpose, audience and these records | A note programme for a global bank's agency and trust business; one current record per topic, the code the authority |
| [0002](0002-code-base-dependencies-and-licences.md) | Code base, dependencies and licences | Two compilation units, pinned T-REX, ONCHAINID and Uniswap v4, a narrow GPL boundary, and nothing upgradeable |
| [0003](0003-networks-deployment-and-verification.md) | Networks, deployment and verification | Local anvil and Ethereum Sepolia, one fixed deployment sequence ending in the ceremony, a fork rehearsal, and every contract verified on Etherscan |
| [0004](0004-hosting-the-site.md) | Hosting the site | Vercel at ethereumtesting.com, or a container in the bank's VM; Postgres, Resend, and records scoped to a deployment |
| [0005](0005-identities-and-claims.md) | Identities and claims | One ONCHAINID identity per client in one shared storage, claims by role that lapse, one note claim for every note |
| [0006](0006-the-tokenized-deposit-and-its-gateway.md) | The tokenized deposit and its gateway | The bank's EURTD: eligibility by its own claim or allowlist, roles under governance, booked credits and debits, and the bank's acts |
| [0007](0007-onboarding-and-custody-routes.md) | Onboarding and custody routes | Bank custody, third-party custodian, self-custody and existing identity, all ending in a registered wallet and claims |
| [0008](0008-the-note-token.md) | The note token | An ERC-3643 T-REX suite per note, logic fixed by our own authority, agents limited to their own powers, owned by the controller |
| [0009](0009-the-note-factory-and-issuance.md) | The note factory and issuance | The Issuer's multi-signature wallet issues a note whole in one transaction, with minimal clones, series and ISIN, straight into governance |
| [0010](0010-terms-and-determinations.md) | Terms and determinations | Terms fixed at issuance; the Calculation Agent's signed outcome must match the contract's own integer computation |
| [0011](0011-record-dates-and-the-stop-on-transfers.md) | Record dates and the stop on transfers | Balances checkpointed at every change; ordinary transfers stop from a possible redemption's Record Time |
| [0012](0012-distributions-through-the-paying-agent.md) | Distributions through the Paying Agent | Pushed in batches to holders of record, verified and closed on the chain, funded by an exact approval as each opens |
| [0013](0013-settlement-by-locked-offer.md) | Settlement by locked offer | Placement, transfers and buy-backs as offers that lock one side and settle both legs or neither |
| [0014](0014-the-governance-controller-and-its-acts.md) | The governance controller and its acts | One controller for every note, a fixed set of typed acts naming the note, and the programme's register of roles |
| [0015](0015-institutions-tiers-thresholds-and-delays.md) | Institutions, tiers, thresholds and delays | A Safe per institution; Tier 2 needs two of three institutions and four signatures, after a delay and within a window |
| [0016](0016-corrections-and-reversals.md) | Corrections and reversals | A determination corrected at any time by Tier 2; paid coupons reversed holder by holder and restated |
| [0017](0017-programme-sanctions.md) | Programme sanctions | One compliance module on every note: a designated account cannot move any note, in one Tier 1 act |
| [0018](0018-the-conversion-pool.md) | The conversion pool | A Uniswap v4 permissioned pool between EURC and the deposit, gated on the deposit's eligibility and a pool-access claim |
| [0019](0019-the-term-sheet-as-a-record.md) | The term sheet as a record | A typed, hashed record is the input to issuance, anchored on the note and published behind sign-in |
| [0020](0020-access-sign-in-and-pages.md) | Access, sign-in and pages | Approved registrations, sign-in by a six-digit code, and pages in plain English that work on a phone |
| [0021](0021-staff-portals-duties-and-four-eyes.md) | Staff portals, duties and four eyes | A portal per institution; determinations and payments proposed and approved by two people with the duty, or an automatic approver by setting |
| [0022](0022-background-jobs.md) | Background jobs | Issuance and payment runs as database jobs, carried on after the response, by page loads and by a daily cron |
| [0023](0023-the-index-of-the-programmes-events.md) | The index of the programme's events | Decoded events of every programme contract in the database, read once, so pages read the book in one query |
| [0024](0024-keys-signing-and-fees.md) | Keys, signing and fees | Keys by capacity, one sender per key under a database lease, and a fee check before every transaction |
| [0025](0025-the-ledger-reconciliation-and-the-audit-log.md) | The Ledger, reconciliation and the audit log | A complete decoded tape, a reproducible statement for any note at any block, and a log of every act |
| [0026](0026-the-book.md) | The book | One page of every note: what each needs next, what is running, and what waits for approval |
| [0027](0027-testing.md) | Testing | Local chain only, seams reproduced, targeted tests per change and the full suite at release tags |

## Numbers cited in the deployed contracts

The contracts deployed on Ethereum Sepolia are verified on Etherscan against their source as it
stands, so their comments keep the record numbers they were written with. Those numbers map to the
records above as follows; nothing else in the code base cites a record by number.

| Cited in a contract | Read |
|---|---|
| 0014 | 0016, corrections and reversals |
| 0031, 0090 | 0018, the conversion pool |
| 0081 | 0013, settlement by locked offer |
| 0085, 0086 | 0008, the note token; 0006, the tokenized deposit |
| 0087 | 0011, record dates; 0002, licences |
| 0088 | 0005, identities and claims; 0008, the note token |
| 0091 | 0009, the note factory and issuance |
| 0092 | 0006, the tokenized deposit and its gateway |
| 0115 | 0014, the governance controller; 0001, purpose and audience |
