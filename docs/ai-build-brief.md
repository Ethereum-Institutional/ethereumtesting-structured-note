# AI build brief: a structured note issued and serviced by smart contract

For the bank's AI-led build. It sets out what to build, the design to follow and how to judge the
result. It points at this repository, release 0.2.0, as a working reference: every requirement
below is implemented and tested there, at the paths given. Read it as a specification and use the
code to see one way of meeting it, not as code to copy unexamined.

Read these first, in order:
1. `docs/solution-overview.html`: the whole design and its reasons.
2. `docs/lifecycle-sequence.md`: the order of events, step by step.
3. `docs/adr/`: one record per decision, with the options considered.

---

## 1. The requirement

Issue a structured note by smart contract to initial investors, pay its coupons, let the Issuer
buy units back, and redeem it on the level of its underlying, early or at maturity. Service it
through to the end, and prove by reconciliation that every position closes at zero.

The note is a worst-of autocallable on a basket:
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
| The deployer renounces | After deployment no party holds a power to upgrade or administer unilaterally (S-01) |
| Tests on a local chain | Every test runs against a local node. Nothing is tested on the public network |
| A record per decision | Every design decision is written as an ADR with the options, the choice and its consequences |

## 3. The design

### Identity and eligibility
- **One identity per client.** An ONCHAINID identity, created by the bank and held in one shared identity-registry storage. There is a registry per asset: the note, the deposit, the conversion pool.
- **Claims from the institution responsible:**
  - the bank's claim that the client may hold the deposit;
  - the onboarding agent's claim that it may hold the note;
  - the bank's pool-access claim.
- **What a claim carries:** its validity period and a hash of the record behind it. It lapses by itself and is revoked only by its issuer.
- **When eligibility is checked:** at every transfer, by the asset's registry.
- **Reference:**
  - `instruments/src/claims/`;
  - the scaffolding in `script/Scaffolding.sol`;
  - `site/lib/identity/`;
  - ADRs 0085 to 0089.

### The note
An ERC-3643 token at decimals 0, around which the deal-specific contracts sit:

| Contract | Role | Reference |
|---|---|---|
| Determination agent | Holds the immutable terms: Initial Levels, the calendar, coupon and MER rules, barrier, Twin Win. Accepts each date's determination only when signed by the Calculation Agent, in turn and from its date; recomputes the outcome itself and rejects one that disagrees. The signature binds the contract and the chain | `instruments/src/DeterminationAgent.sol` |
| Record-date module | A compliance module that fixes holders of record at each Record Time, inclusive, and stops transfers from a Record Time that could redeem until it is determined | `instruments/src/compliance/RecordDateModule.sol` |
| Paying agent | Opens each distribution from its Payment Date. The units of record exclude the Issuer's inventory. It draws the whole amount from the Agent's deposit, pays holders in batches, and holds the payment for a holder the deposit cannot credit, to be claimed later. Redemption burns units as they are paid | `instruments/src/PayingAgent.sol` |
| Locked settlement | Delivery versus payment by locked offer: both legs in one transaction, each side locked until it settles, is released or expires | `instruments/src/LockedSettlement.sol` |
| Governance controller | Tier 1 and Tier 2 interventions, through multi-signature wallets of each institution | `instruments/src/GovernanceController.sol` |
| Note factory | Issues a note whole, in one transaction, from its term sheet. Each agent is restricted to its own powers; the note starts paused, with its notional in the Issuer's inventory | `instruments/src/factory/` |

**The term sheet as data.** The term sheet is a typed record and the input to issuance. Each field
has a value or a stated reason it does not apply. Its canonical JSON (JCS) is hashed with keccak256,
and the hash is put on the note's identity as a claim. Anyone can check the on-chain terms against
the record. Reference: `site/lib/notes/termsheet.ts`, ADR 0095.

### The deposit
The bank's tokenized deposit is an allowlist token whose eligibility comes from the same
identities. The bank:
- credits and debits it against booking references;
- holds part of a balance;
- pauses it;
- moves it by order, with its reason on-chain.

Reference: `instruments/src/DepositToken.sol`, `instruments/src/DepositGateway.sol`, ADR 0092.

### The conversion pool (deployed by default, can be left out)
A Uniswap v4 pool between the euro payment token (EURC) and the deposit. A hook admits only
wallets holding the bank's pool-access claim. Reference: `contracts/`, ADR 0090.

### The site
Five portals behind one sign-in by emailed six-digit code:
- the bank;
- the onboarding agent;
- the Agent;
- the custodians;
- the client.

It holds the institutions' records off-chain and signs each act with the acting capacity's key. It
reads all state at one block, so a page never mixes two heights. It also provides:
- a Ledger rebuilt from chain events alone;
- a reconciliation statement for any note as at any day, now or a block, in JSON and CSV.

Reference: `site/`, ADRs 0089, 0093 and 0094.

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
| 2. Issuance | Issued whole through the factory from its term sheet, the hash matching the on-chain terms |
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

Each test names the scenario or ADR it proves.

## 6. Lessons the reference paid for

| Lesson | Why it matters | Where |
|---|---|---|
| Ethereum Sepolia runs Amsterdam; creating contracts costs about five times more gas than older simulators assume | Deploy with the chain's own gas estimates, one transaction at a time | ADR 0098 |
| T-REX contract sizes sit near the limit | Split deployers to stay under it | `instruments/src/factory/` |
| An RPC may answer from a block behind the last write | Wait for the state you expect before reading on; read a page's data at one pinned block | `site/lib/chain/until.ts`, `site/lib/chain/safe.ts` |
| A multi-signature wallet's nonce races with its own transactions | Wait for the nonce to move before signing the next | `site/lib/chain/safe.ts` |
| Decimals default to eighteen | Set them to zero and assert it under test | `instruments/test/Instruments.t.sol` |
| A Record Time on a block boundary | Holders of record include the block stamped at the Record Time | `RecordDateModule.sol`, ADR 0096 |

## 7. Still open

- **The bank's term-sheet field list.** It will be fitted to the record's field catalogue.
- **The bank's detailed order of events.** It will be mapped to `docs/lifecycle-sequence.md`.
- **S-17's nominee suspense account.** The distinct event is not built.
- **Hardening before execution:**
  - a separate key for each capacity;
  - freezing the contracts once the Issuer and the Calculation Agent confirm the payoff items;
  - the internal assurance review;
  - token naming.
