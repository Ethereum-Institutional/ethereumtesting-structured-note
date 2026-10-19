# Structured note PoC: handoff

Written so a later session can pick this up with no prior context. Section 1 is the state at
release 0.3.0. The sections after it are what still holds from how the project got here: decisions
in force, verified findings, open items, hazards, and positions worth keeping. Designs that were
replaced are not described here; the decision records in `docs/adr/` describe the design as it
stands, and git history keeps the rest.

**Naming discipline applies to this file and to everything in this repository.** Parties are
referred to by capacity. No client, counterparty or vendor is named here, in the code, in
deployed metadata, or in the repository and remote names. Client-specific context lives in the
private working documents, not in this tree.

---

## 1. Where things stand: release 0.3.0

**0.3.0 turns one demonstration note into a note programme,** run as an agency and trust desk
would run it: many notes, sometimes issued several at once, each managed through its life under one
governance framework. The plan, the owner's six decisions and the status of each workstream are in
`docs/plan/0.3.0.md`. 0.2.0, which it builds on, is summarised in `docs/plan/0.2.0.md`.

**The contracts** (`instruments/`, and the venue at the root):
- **One governance controller for every note.** Every act names the note it concerns. Tier 1 is
  the Agent's governance wallet alone, with a written reason; Tier 2 needs two of three
  institutions and four signatures, after a delay and within a window. It also administers the
  deposit's and the gateway's roles, and owns the pool's registries and the venue.
- **The note factory, owned by the Issuer's 2-of-3 wallet.** One transaction issues a note whole,
  or several in one call: a series number and an optional ISIN, the note's four lifecycle
  contracts as minimal clones of fixed implementations, the T-REX suite, any extra claims the
  series requires, the deposit allowlisting, and the hand-over to the controller in the same
  transaction. The Issuer holds no power over a note once issued. Issuing one note costs about
  5.7 million gas.
- **The programme's register of roles:** the servicing wallet, the Calculation Agent and the
  funder, read by every note's contracts, each rotated for the whole book by one Tier 2 act.
- **Programme sanctions:** one compliance module on every note; one Tier 1 act stops an account on
  every note at once.
- **Money:** each distribution is funded by an approval of exactly its amount, given as it opens,
  from the Agent's pooled deposit account.
- **Corrections:** a Tier 2 act corrects a note's latest determination, reversing and restating a
  paid coupon. Tier 2 also retires a redeemed note from the identity storage and can release
  T-REX's factory to a successor.

**The desk** (`site/`):
- **Background jobs.** Issuance and payment runs live in the database and are carried on after the
  response, by every staff page load, and by a cron route (`/api/jobs/tick`, protected by
  `CRON_SECRET`). Vercel's Hobby plan allows the cron once a day (06:00 UTC, `site/vercel.json`); a
  plan with per-minute crons needs only that schedule changed.
- **One sender per key** across servers, under a lease in the database that carries the next nonce.
- **The event index.** Decoded events of every programme contract in the database, so pages read
  the book in one query. On a public network the three newest blocks are left to settle;
  `INDEX_SETTLE_BLOCKS` makes the local index lag the same way for tests. An action that must read
  what it has just made reads the contract where the index does not hold it yet.
- **The Book:** every note on one page, what each needs next, and what awaits approval, is running
  or has failed.
- **Four eyes by duty.** `CALCULATION_EMAILS` and `PAYMENTS_EMAILS` name the Agent's staff with
  each duty (unset, everyone at the Agent's desk holds it). A second person with the duty approves
  each determination and payment. `FOUR_EYES=auto`, the default, has an automatic second approver
  for demonstrations; `FOUR_EYES=strict` requires a person.
- **Issuance from a term sheet** staff upload, with its ISIN, checked before anything is sent; or a
  demonstration note from a scenario, with an offer period before the first observation.
- **Every view across every note:** holdings on the participants page, the register
  reconciliation, and the closing checks.
- **Onboarding.** The onboarding agent relies on the bank's KYB while the bank's claim stands, and
  its one note claim admits a client to every note. Custody references on the chain are opaque
  (`SEG-` and part of a hash). Wallets are registered with the client's own jurisdiction (ISO 3166
  numeric) from the bank's record, and corrected when the bank renews its claim; a brought identity
  is registered as "not known".

**Deployed to Ethereum Sepolia** (chain 11155111) on 17 October 2026, every contract verified on
Etherscan, clones and linked libraries included. The manifest is
`ops/addresses.ethereum-sepolia.json`, kept locally and ignored by git, like the keys it was
deployed with (`ops/keys.ethereum-sepolia.env`):

| Contract | Address |
|---|---|
| The first note: EUR Worst-of Autocallable Note (EURWAN) | `0xDC0ad74FAcf92dfEb34c703bcC4fbC983c7F3111` |
| The tokenized deposit: Euro Tokenized Deposit (EURTD) | `0x8d8997E153161BC9D60c62796103D177fc331fE8` |
| The note factory | `0x0DE7B93F5fC41f4781a6aDde39D4f86c03F77d2d` |
| The governance controller | `0x9F384c954e0E85d03843b4B514af6a8783E24dE9` |
| The Issuer's wallet, the factory's owner | `0xC2f545dDCd3F75ac6A6bC151Fd15FE22e97BC331` |
| The servicing wallet | `0x66a5CB7420D5FE794B835fB657E2270F7b9E215c` |
| The programme's sanctions module | `0x777B397151706a717Fe52F92189C55B9743d0492` |
| The shared identity storage | `0x0828418bA2BE68b0BE3871168BaDDfe5E63429Ec` |
| The pool's hook | `0x3D38793E5D7982CD2A230a084d5b1BBE6d1228c0` |

**Deploying to Ethereum Sepolia** is `./ops/sepolia.sh` with one subcommand:
- `check`: every key's balance at three times today's gas price; sends nothing;
- `deploy`: the whole stack, public and permanent, then Etherscan verification;
- `verify`: retries verification;
- `site-env`: points the site's Vercel project at the deployment, including a fresh `CRON_SECRET`.

The order is fixed by `ops/deploy-stack.sh`: base, `DeployInstruments`, the venue (01 to 03),
custody (04), `DeployProgramme`, the term sheet, `IssueNote`, and the ceremony. Ethereum Sepolia
runs Amsterdam: deploying costs about 5.5 times the gas the local node shows, so the deploy takes
each transaction's gas from the chain. Rehearse on a fork first, with `ops/dry-run-fork.sh`. A
release whose contracts change is a fresh deployment: notes, onboardings and the event index start
again, while registrations, the bank's client records and the audit log carry over.

**Releases.** `v0.3.0` is tagged and signed. The changes since it (the demonstration form's offer
period, a placement reading a new offer from the contract, wallets registered with the client's
jurisdiction) go out as `v0.3.1`.

**Not built in 0.3.0,** carried forward:
- the payer and the onboarding agent in the programme's register of roles;
- an audit log filtered by note and by person;
- on the Book: funding against what is due, positions per client, offers expiring and amounts held.

**Waiting on the bank:** its term-sheet field list, fitted to the record's field catalogue, and its
detailed order of lifecycle events, mapped to `docs/lifecycle-sequence.md`.

**Tests.** Every test runs on the local chain; nothing is tested against a public network.
`cd site && npm run test:local` runs everything: it resets the chain (a snapshot restored in
seconds, or a fresh deployment when the deployment's sources changed), then the site's unit,
integration and browser tests. Contracts: `cd instruments && forge test`, and the venue's
`forge test --fork-url http://127.0.0.1:8545` against the deployed stack. A change runs the tests
that cover it; the full suite runs at release tags, or on request. A page is done only once a
browser spec has clicked through it.

**The site** is deployed from the repository root to the Vercel project, on the ethereumtesting.com
domain only, at `https://structurednote-project.ethereumtesting.com`, with deployment protection on.
Sign-in is by emailed code; the portals are given by role lists in its environment (`BANK_EMAILS`,
`ONBOARDING_EMAILS`, `AGENT_EMAILS`, `CUSTODIAN_EMAILS`; `OPERATOR_EMAILS` holds every role and
both duties). Postgres is Neon; mail is Resend. See `site/README.md`. For the bank's own virtual
machine, see `docs/it-handover.md`.

**Hazards worth knowing:**
- **The T-REX 5.0.0-beta2 implementation authority** lets anyone switch versions. We deploy our own fixed authority in its place. Never deploy T-REX's.
- **A load-balanced RPC answers a block behind** for a moment after a receipt. Every site write that a later read depends on waits for the read to show it; the integration and browser tests run through a proxy that lags on purpose.
- **The event index lags a public network by three blocks,** about 36 seconds. What an action has just made is read from the contract, not the index.
- **Two compilation units.** No file may import both the position manager and the pool manager (section 3). After changing a contract the deployment embeds, the deploy script forces a build of both units.
- **The controller sits near the size limit.** Acts go into libraries called by delegatecall (`VenueActs`, `CorrectionActs`); `ops/build.sh` fails on any contract over EIP-170.

`origin` is a **private** repository in the organisation's GitHub account
(`Ethereum-Institutional/ethereumtesting-structured-note`). `upstream` still points at the source
demo for reference, with its push URL set to `DISABLED` in the local clone, so nothing can be pushed
there by accident. That setting is local: repeat it in any new clone that adds `upstream`.

**Decision records.** `docs/adr/` holds 27 current records, 0001 to 0027, indexed in its README.
They describe the design as it stands, not its history; where a record and the code disagree, the
code is right and the record is corrected. Record each decision there, with its options, rationale
and consequences, in the same change as the work it governs. Nothing a user sees cites a record.
The deployed contracts' comments keep the older numbers they were verified with; the index maps
them to the current records.

---

## 2. Founding decisions still in force

Numbered as first taken; those since superseded are omitted.

| # | Decision |
|---|---|
| D1 | ERC-20 base for both tokens, for custodian, wallet and explorer compatibility |
| D3 | ERC-7943 (uRWA) as the deposit's compliance interface |
| D5 | Cash leg is a simulated tokenized deposit, not a third-party stablecoin |
| D6 | "Determination Agent", not "oracle". EIP-712 signed determinations |
| D7 | Off-chain register is golden source; on-chain state is evidence of it |
| D8 | No AMM for the note. Bilateral DvP plus issuer buyback |
| D9 | Permissioned v4 pool in scope for FX conversion only |
| D10 | Public test network now; migrate mid-2027 |
| D11 | Eligibility checker is a standalone contract behind its own interface |
| D13 | Two-tier privileged powers: register correction versus amendment |
| D14 | Custody in scope, with a nominee model for distributions |
| D16 | Generic throughout. No client or vendor identifiers anywhere |
| D17 | **Independent audit gates mainnet, not testnet.** Testnet execution is gated by internal assurance review. This is a proposed variation to the client's draft and is flagged as such |

---

## 3. Verified technical findings

These took real investigation. Do not re-derive them.

### Venue

- **The AMM provider ships no production permissioned hook.** `src/hooks/permissionedPools/`
  contains `BaseAllowListChecker`, `PermissionedPositionManager`, `PermissionedV4Router`,
  `PermissionsAdapter`, `PermissionsAdapterFactory`, `interfaces/`, `libraries/` and no hook. The
  documentation describes one architecturally. The inherited `PermissionedComplianceHook` is
  therefore genuinely the missing piece, is reused unchanged, and **sits in audit scope**.
- **The permissioned stack is deployed on no network**, test or main. The whole periphery is
  deployed by us.
- **EIP-170 is solved for the venue (spike 1).** The position manager is 23,195 bytes under a
  per-path restriction at 500 runs. The pool library does not compile at low runs, so **no file
  may import both the position manager and the pool manager**; the deploy script deploys both
  from artifacts. Run `forge clean` after changing the restrictions; the incremental cache
  reports mixed sizes.
- Core v4 **is** on Ethereum Sepolia. Reuse the deployed `PoolManager` and canonical Permit2
  rather than deploying our own; only the local chain installs them.
- The checker interface is
  `checkAllowlist(address account, address tokenAddress) returns (PermissionFlag)` on a
  **floating `^0.8.0` pragma**, so one checker satisfies every consumer with no cross-unit shim.
  `PermissionFlag` is a `bytes2` user type: `NONE 0x0000`, `SWAP_ALLOWED 0x0001`,
  `LIQUIDITY_ALLOWED 0x0002`, `ALL_ALLOWED 0xFFFF`. Extend `BaseAllowListChecker`.
- `tokenAddress` is a parameter, so **one checker serves every instrument**.
- Per-pool gate addresses are the intended model.

### Instruments and deployment

- **Forge's incremental build can hide a changed contract.** A test that deploys a contract kept
  its old creation code after the contract changed, so a deliberately broken payoff passed. Run
  `forge test --force` after any contract change; the deploy forces a build of both units.
- **Full lifecycle contracts per note do not fit in one factory,** and cost far more. Minimal
  clones of fixed implementations, initialised once in the issuing transaction, halved the cost
  of a note.
- **Ethereum Sepolia prices state creation far above what forge simulates.** On a public network
  the deploy skips forge's simulation and sends one transaction at a time, each with the chain's
  own gas estimate.
- **A multi-signature wallet's second act in quick succession** could sign over a nonce already
  used, read from a node a block behind. Each act now waits until the wallet's new nonce reads
  back.
- **The tape finds transactions by the events watched contracts emit,** so a transaction that
  emitted none, a reverted one in particular, does not appear in the Ledger. Stated in the code.
- **The local node's published keys carry EIP-7702 delegations on public networks.** A public
  deployment uses its own key per capacity, from `ops/new-network-keys.sh`; the deploy refuses the
  published ones.

---

## 4. Deliberately open

- **Payoff confirmations C1 to C10** (`docs/spikes/03-payoff-specification.md` section 10) by the
  Issuer and the Calculation Agent. The build uses the specification's defaults, with Twin Win
  applicable. Each item is a parameter or one clause, so a changed answer changes terms or one
  line, and the vectors are regenerated.
- **S-17's nominee suspense account.** A custody account is paid as a holder of record; the
  suspense account and its distinct event are not built.
- **Delegation of individuals to a custodian** needs designing.
- **Who plays the onboarding agent,** and whether it must be licensed, is for the bank's markets
  and legal teams.
- **Hardening before execution:** each wallet owner signing from its own device, not the site
  holding two owners' keys of each wallet; `FOUR_EYES=strict`; the final freeze of the contracts
  once C1 to C10 and token naming are confirmed; the internal assurance review.

Two gates sit outside engineering: the **independent audit** and **token naming sign-off**.
Neither blocks building; both block executing.

**Operational items:**
- **Mail sender.** Production `MAIL_FROM` is `Structured Note PoC <noreply@ethereumtesting.com>`,
  on the Resend domain. If sends fail, check the API key is not restricted to another domain.
- **Rotate the Resend key** before the site carries anything real; it was pasted into a session.
- **Deploying the site** is from the repository root, always with `--scope ethereuminstitutional`:
  another local session also uses the Vercel CLI and changes its default scope. From `site/` the
  build fails, because it copies from `docs/`. Environment variables are set through the REST API
  (`./ops/sepolia.sh site-env`), as sensitive production variables, because `vercel env add` hangs
  non-interactively.
- **Commits are GPG-signed** and need the passphrase at the keyboard.
- **The site is on Next 15.** An `npm audit` advisory in its bundled postcss was open at last
  check; the fix is Next 16, a breaking change, not yet taken.

---

## 5. Hazards

- **Submodules are not checked out** in a fresh clone. Nothing compiles until they are
  initialised; `ops/build.sh` names the first one missing.
- **`vercel integration add` writes agent skill files into the repository** (`.agents/skills/`,
  symlinks under `.claude/skills/`, and `skills-lock.json`), unrequested and vendor-named. Delete
  them after any integration install.
- **Dates are the chain's own.** The local issuance dates the schedule from the chain's clock, and
  tests move the clock rather than wait. A public deployment fixes real dates at issuance, which is
  correct there.
- **The manifest as an environment variable** has a size ceiling on a host. The site prefers a file
  (`MANIFEST_PATH`); on Vercel it is embedded as `MANIFEST_JSON`, which grows with the deployment.

---

## 6. Positions worth keeping intact

These were argued for and should not be quietly reversed.

- **Both venues, but the note never touches the AMM.** The pool is for cash conversion. A
  worst-of autocallable reprices discontinuously and its holder-of-record question inside a pool
  is unresolved.
- **The eligibility perimeter sits at the wallet, before the pool, not at the asset.** Describing
  the conversion facility as permissionless would be a compliance misstatement.
- **Forced transfer is the most powerful function in the system** and deserves disproportionate
  attention in access control, thresholds and logging.
- **No general-purpose call path in the controller.** A fixed selector set is the entire
  difference between a control framework and a back door.
- **Two thresholds for Tier 2**, a count of signatures and a count of distinct institutions. One
  number cannot express the difference.
- **No single key issues, and the Issuer keeps nothing after issuance.** A note is governed from
  its first block.
- **Eligibility is established cryptographically, recorded on-chain, bounded in time, and
  revocable immediately.** Do not upgrade this to "verified on-chain at every transfer", which is
  false and is the sort of claim a reviewer tests.
- **Settlement finality in a contract is not legal finality**, which is conferred by the register
  update. Never conflate them in an external document.
- **No cryptocurrency is involved.** Network fees are paid in valueless faucet units, which is
  stated rather than hidden.
