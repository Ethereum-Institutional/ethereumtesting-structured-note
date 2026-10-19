# AI build brief: a structured note issued and serviced by smart contract

For the bank's AI-led build. It sets out what to build, the design to follow and how to judge the
result. It points at this repository, release 0.3.0, as a working reference: every requirement
below is implemented and tested there, at the paths given. Read it as a specification and use the
code to see one way of meeting it, not as code to copy unexamined.

Read these first, in order:
1. `docs/solution-overview.html`: the whole design and its reasons.
2. `docs/lifecycle-sequence.md`: the order of events, step by step.
3. `docs/adr/`: one current record per topic, with the options considered, indexed in its README.

---

## 1. The requirement

Issue structured notes by smart contract to initial investors, pay their coupons, let the Issuer
buy units back, and redeem each on the level of its underlying, early or at maturity. Service each
through to the end, and prove by reconciliation that every position closes at zero.

The notes form a programme: many notes, sometimes issued several at once, each managed through its
life under one governance framework, every act naming the note it concerns, by one desk.

Each note is a worst-of autocallable on a basket:
- 1 unit = €1,000, indivisible (decimals 0);
- quarterly observation dates;
- conditional coupons, with memory where the terms say so;
- Mandatory Early Redemption (MER) against a trigger;
- a barrier, and Twin Win where applicable.

Settlement is in the bank's tokenized deposit. Everything runs on a public test network
(Ethereum Sepolia) and carries no value.

## 2. Constraints that are not negotiable

| Constraint | What it means for the build |
|---|---|
| No institution named | No client, bank or vendor name in contracts, deployed metadata, events or the repository. Parties are identified by capacity: Issuer, Agent, Calculation Agent, the bank, onboarding agent, custodian, investor |
| No personal data on the chain | Identities carry claims and salted hashes of the records behind them, never the facts. Inspect every deployed contract and event for personal data (S-36) |
| Controls bind in code | Every negative scenario is refused by a named contract check, never by procedure. Each control has a test showing it refuse |
| Standards first | ERC-3643 (T-REX) with ONCHAINID for the note's permissioning; ERC-7943 for the deposit's allowlist. Write a contract only where no standard covers the need: the payoff, the record dates, the paying agent, settlement and governance |
| The payoff is specified before it is built | Strict or inclusive barriers, inclusion at the Record Time, and the direction of rounding are written down first, then checked against an independent model across a scenario grid, to the cent |
| No single party moves the register alone | Forced transfers go only through the governance controller: Tier 1 for corrections, with a written reason; Tier 2 with signatures from two institutions, a timelock and an expiry |
| No single key issues | The note factory is owned by the Issuer's multi-signature wallet; once issued, a note belongs to the governance controller and the Issuer holds no power over it |
| The deployer renounces | After deployment no party holds a power to upgrade or administer unilaterally (S-01) |
| Tests on a local chain | Every test runs against a local node. Nothing is tested on the public network |
| A record per decision | Every design decision is written as a record with the options, the choice and its consequences, kept current with the code |

## 3. The design

### Identity and eligibility
- **One identity per client.** An ONCHAINID identity, created by the bank and held in one shared identity-registry storage, with the wallet registered under the client's own jurisdiction (ISO 3166 numeric) from the bank's record. There is a registry per asset: each note, the deposit, the conversion pool. Note registries read the storage and never write to it.
- **Claims from the institution responsible:**
  - the bank's claim that the client may hold the deposit;
  - the onboarding agent's claim that it may hold the programme's notes, one claim for every note, given in reliance on the bank's KYB while the bank's claim stands;
  - optionally, up to four further claims a series requires;
  - the bank's pool-access claim.
- **What a claim carries:** its validity period and a hash of the record behind it. It lapses by itself and is revoked only by its issuer.
- **When eligibility is checked:** at every transfer, by the asset's registry.
- **Reference:**
  - `instruments/src/claims/`;
  - the scaffolding in `instruments/script/Scaffolding.sol`;
  - `site/lib/identity/`;
  - records 0005 (identities and claims) and 0007 (onboarding and custody routes).

### The programme and its notes
Each note is an ERC-3643 token at decimals 0, issued with its own lifecycle contracts as EIP-1167
minimal clones of fixed implementations, so one note's fault cannot reach another's. Shared by every
note: the governance controller, the note factory, the sanctions module, the identity storage and
the deposit.

| Contract | Role | Reference |
|---|---|---|
| Determination agent | One per note. Holds the immutable terms: Initial Levels, the calendar, coupon and MER rules, barrier, Twin Win. Accepts each date's determination only when signed by the programme's Calculation Agent, in turn and from its date; recomputes the outcome itself and rejects one that disagrees. The signature binds the contract and the chain | `instruments/src/DeterminationAgent.sol` |
| Record-date module | One per note. A compliance module that fixes holders of record at each Record Time, inclusive, and stops transfers from a Record Time that could redeem until it is determined | `instruments/src/compliance/RecordDateModule.sol` |
| Paying agent | One per note. Opens each distribution from its Payment Date. The units of record exclude the Issuer's inventory. It draws the whole amount from the Agent's deposit account, under an approval of exactly that amount given as it opens, pays holders in batches, and holds the payment for a holder the deposit cannot credit, to be claimed later. Redemption burns units as they are paid | `instruments/src/PayingAgent.sol` |
| Locked settlement | One per note. Delivery versus payment by locked offer: both legs in one transaction, each side locked until it settles, is released or expires | `instruments/src/LockedSettlement.sol` |
| Governance controller | One for every note. Tier 1 and Tier 2 interventions through typed acts naming the note, by each institution's multi-signature wallet; the programme's register of roles (servicing wallet, Calculation Agent, funder), so a rotation is one act for the whole book; the deposit's roles; corrections of a determination | `instruments/src/GovernanceController.sol` |
| Programme sanctions | One compliance module on every note: an account designated by one Tier 1 act cannot move any note | `instruments/src/compliance/ProgrammeSanctions.sol` |
| Note factory | Owned by the Issuer's 2-of-3 wallet. Issues a note whole, in one transaction, from its term sheet, or several in one call: a series number and an optional ISIN, each agent restricted to its own powers, the notional in the Issuer's inventory, the lifecycle contracts allowlisted on the deposit, and the note handed to the controller in the same transaction | `instruments/src/factory/` |

**The term sheet as data.** The term sheet is a typed record and the input to issuance. Each field
has a value or a stated reason it does not apply. Its canonical JSON (JCS) is hashed with keccak256,
and the hash is put on the note's identity as a claim. Anyone can check the on-chain terms against
the record. Staff issue from an uploaded record, with its ISIN, checked before anything is sent.
Reference: `site/lib/notes/termsheet.ts`, record 0019 (the term sheet as a record).

### The deposit
The bank's tokenized deposit is an allowlist token whose eligibility comes from the same
identities. The bank:
- credits and debits it against booking references;
- holds part of a balance;
- pauses it;
- moves it by order, with its reason on-chain.

Its roles are administered by the governance controller, by Tier 2 act. Reference:
`instruments/src/DepositToken.sol`, `instruments/src/DepositGateway.sol`.

### The conversion pool (deployed by default, can be left out)
A Uniswap v4 pool between the euro payment token (EURC) and the deposit. A hook admits only
wallets holding the bank's pool-access claim, in a jurisdiction the pool serves. Reference: `contracts/`.

### The site
Five portals behind one sign-in by emailed six-digit code:
- the bank;
- the onboarding agent;
- the Agent;
- the custodians;
- the client.

It holds the institutions' records off-chain and signs each act with the acting capacity's key,
one sender per key across servers under a database lease. It also provides:
- **the Book:** every note on one page, what each needs next, and what awaits approval, is running
  or has failed;
- **background jobs:** issuance and payment runs kept in the database and carried on after the
  response, by staff page loads and by a scheduled run, so no page has to stay open;
- **an index of the programme's events** in the database, so pages read the book in one query;
- **four eyes:** determinations and payments proposed by one person with the duty and approved by a
  second;
- a Ledger rebuilt from the chain alone;
- a reconciliation statement for any note as at any day, now or a block, in JSON and CSV.

Reference: `site/`, records 0020 to 0026.

## 4. The order of events

`docs/lifecycle-sequence.md` lists each step: who acts, from when, and what is refused if it is
tried out of turn. Build to it. `instruments/test/Sequence.t.sol` walks one note through every step
in order, trying each one early first. A build that passes an equivalent walk follows the sequence.

## 5. Acceptance

The build is done when each of the bank's nine success criteria is shown, with its evidence, and
each scenario S-01 to S-36 passes. Both are in the overview's "Success criteria" and "Test
scenarios" sections.

| Criterion | Shown by |
|---|---|
| 1. Full deal lifecycle | One note from issuance to closure; the lifecycle reconstructed from events alone; the statement reads Closed |
| 2. Issuance | Issued whole through the factory from its term sheet, by the Issuer's wallet, the hash matching the on-chain terms |
| 3. A coupon | Holders paid their balance at the Record Time; inventory excluded |
| 4. A secondary transfer | Both legs together; refused to an ineligible buyer |
| 5. KYC enforcement | A revoked or lapsed claim refuses the next transfer at once |
| 6. Registry reconciliation | Identities on chain against the onboarding records |
| 7. Day-to-day reconciliation | A statement as at any day, reproducible from the chain |
| 8. Buy-back | Into the inventory, which earns no coupon; the tranche never reduced beyond it |
| 9. Logic validation | The payoff matched to an independent model across 25 scenarios, to the cent |

The reference's tests (`README.md`, "Running it locally"):
- contract tests in `instruments/test/` and `test/`;
- the payoff vectors in `instruments/test/vectors/`;
- integration tests and browser tests in `site/test/`.

Each test names the scenario or control it proves.

## 6. Lessons the reference paid for

| Lesson | Why it matters | Where |
|---|---|---|
| Ethereum Sepolia runs Amsterdam; creating contracts costs about five times more gas than older simulators assume | Deploy with the chain's own gas estimates, one transaction at a time | `ops/deploy-stack.sh` |
| Full contracts per note exceed what one factory may hold, and cost far more | Minimal clones of fixed implementations; acts in libraries called by delegatecall | `instruments/src/factory/`, `instruments/src/CorrectionActs.sol` |
| An RPC may answer from a block behind the last write | Wait for the state you expect before reading on; read a page's data at one pinned block | `site/lib/chain/until.ts`, `site/lib/chain/safe.ts` |
| A multi-signature wallet's nonce races with its own transactions | Wait for the nonce to move before signing the next | `site/lib/chain/safe.ts` |
| Several servers can send from one key | One sender per key, under a database lease that carries the next nonce | `site/lib/chain/signer.ts` |
| A public network's event index lags the head | Read what an action has just made from the contract itself | `site/lib/notes/place.ts` |
| Decimals default to eighteen | Set them to zero and assert it under test | `instruments/test/Instruments.t.sol` |
| A Record Time on a block boundary | Holders of record include the block stamped at the Record Time | `RecordDateModule.sol`, `instruments/test/Sequence.t.sol` |

## 7. Still open

- **The bank's term-sheet field list.** It will be fitted to the record's field catalogue.
- **The bank's detailed order of events.** It will be mapped to `docs/lifecycle-sequence.md`.
- **S-17's nominee suspense account.** The distinct event is not built.
- **Not yet built:** the payer and the onboarding agent in the programme's register of roles; an
  audit log filtered by note and by person; on the Book, funding against what is due, positions per
  client, offers expiring and amounts held.
- **Hardening before execution:**
  - each wallet owner signing from its own device, not the site holding two owners' keys;
  - four eyes required of a person (`FOUR_EYES=strict`);
  - freezing the contracts once the Issuer and the Calculation Agent confirm the payoff items;
  - the internal assurance review;
  - token naming.
