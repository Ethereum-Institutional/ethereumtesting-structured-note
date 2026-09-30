# Structured note PoC: phase handoff

Status at the close of the first phase. Written so a later session can pick this up with no
prior context.

**Naming discipline applies to this file and to everything in this repository.** Parties are
referred to by capacity. No client, counterparty or vendor is named here, in the code, in
deployed metadata, or in the repository and remote names. Client-specific context lives in the
private working documents, not in this tree.

---

## 1. Where things stand

**Phase 0a is complete.** The deliverable is `docs/solution-overview.html`: a self-contained,
navigable solution overview covering roles, instrument, lifecycle, identity, controls, standards,
success criteria, programme, test scenarios, responsibilities, approvals and next steps. It was
reviewed and signed off.

**Phase 0b is deployed** from `site/` to the Vercel project `structurednote` (team scope, Hobby
plan, research use): registration with email verification, then approval by an operator or by
the domain rule, everything gated, the architecture as the signed-in home page with each
component linked into the overview. Postgres is Neon in Frankfurt. Mail is Resend, sending from
`noreply@ethereumtesting.com`. The domain rule's list and the operator list live only in the
Vercel environment, not in this repository. See `site/README.md`. Since Wave 5 the site also
admits participants to the conversion pool (`/onboard`, `/operator`), against an integration
deployment on the public test network (section 5).
The repository is a clone of the source demo with history preserved. **Wave 1 has stripped it to
the venue** (section 5); nothing of the retired identity stack, the source console or the source
hosting remains in the tree, only in history.

`origin` is a **private** repository under the owner's personal account
(`benjaminchodroff/structured-note-poc`), created 24 September 2026. `upstream` still points at
the source demo for reference, with its push URL set to `DISABLED` in the local clone, so nothing
can be pushed there by accident. That setting is local: repeat it in any new clone that adds
`upstream`.

**Decision records.** Every design decision since Wave 1 is an ADR in `docs/adr/`, with the
options considered and why the choice won (ADR 0001). Record each new decision there, in the same
change as the work it governs. The W and L items below are ADRs 0003 to 0012.

---

## 2. Decisions taken

| # | Decision |
|---|---|
| D1 | ERC-20 base for both tokens, for custodian, wallet and explorer compatibility |
| D2 | An established open standard for tokenized debt securities as the implementation base |
| D3 | ERC-7943 (uRWA) as the compliance interface |
| D4 | The incumbent securities-identity standard retired entirely |
| D5 | Cash leg is a simulated tokenized deposit, not a third-party stablecoin |
| D6 | "Determination Agent", not "oracle". EIP-712 signed determinations |
| D7 | Off-chain register is golden source; on-chain state is evidence of it |
| D8 | No AMM for the note. Bilateral DvP plus issuer buyback |
| D9 | Permissioned v4 pool in scope for FX conversion only |
| D10 | Public test network now; migrate mid-2027 |
| D11 | Eligibility checker is a standalone contract behind its own interface |
| D12 | **Credential platform selection deliberately deferred.** The layer is specified by capability, not product |
| D13 | Two-tier privileged powers: register correction versus amendment |
| D14 | Custody in scope, with a nominee model for distributions |
| D15 | New repository, cloned from the source demo with history |
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
- Core v4 **is** on the target test network. Reuse the deployed `PoolManager` and canonical
  Permit2 rather than deploying our own, which the inherited local scripts do.
- The checker interface is
  `checkAllowlist(address account, address tokenAddress) returns (PermissionFlag)` on a
  **floating `^0.8.0` pragma**, so one checker satisfies every consumer with no cross-unit shim.
  `PermissionFlag` is a `bytes2` user type: `NONE 0x0000`, `SWAP_ALLOWED 0x0001`,
  `LIQUIDITY_ALLOWED 0x0002`, `ALL_ALLOWED 0xFFFF`. Extend `BaseAllowListChecker`.
- `tokenAddress` is a parameter, so **one checker serves every instrument**.
- Per-pool gate addresses are the intended model.

### Debt standard

- Pin at the **release candidate**, not the latest stable. Snapshots, the holder list and full
  enforcement exist only from the RC. The stable release ships the snapshot *interface* but
  nothing that composes it into a token, and snapshots are the entire reason the standard was
  chosen. Declare the RC to the audit firm and make re-pinning to the final release a gate before
  anything moves past PoC.
- Licence is permissive with weak copyleft. No contamination issue.
- **Pragma is `^0.8.24`, floating.** It compiles at the version the AMM adapter pins exactly,
  **but it does not fit there** (corrected by spike 1, below). Solc is not a barrier to
  compilation; it is a barrier to size.
- **Size (spike 1).** No shipped variant has everything the note needs, and no compiler setting
  fits the needed set on the standard bases. A lean composition from the rule-engine layer
  (omitting cross-chain and the gasless forwarder) fits at 24,004 bytes, **572 spare**, but only
  on the legacy pipeline with solc 0.8.27 or later. The venue's unit is 0.8.26 IR, where the same
  contract is 26,737. **So instruments build in their own compilation unit**, which also
  removes the library version conflict. The debt attributes module does not fit. The composing
  contract is ours and in audit scope. Detail in `docs/spikes/01-contract-size.md`.
- Native UUPS, with its own upgrade role. That role is what the Tier 2 ceremony holds.
- **The standard's default admin silently holds every role** (its `hasRole` override), including
  forced transfer, upgrade and replacement of the gate. The composition restores plain semantics
  so that any self-grant is a visible `RoleGranted`. Do not drop this override: without it the
  two tiers collapse into whoever holds the admin role (spike 2, A4).
- **As shipped, `canSend`/`canReceive` ignore eligibility and `canTransfer` can revert** through
  the rule engine. Both are fixed in the composition by a bounded, fail-closed gate query. A
  `try` block is not sufficient (spike 2, A1 and A2).
- The enforcement module exposes `forcedTransfer(from, to, value, bytes data)` and partial freeze
  with the same payload. **That payload carries the written intervention reason**, so the
  justification travels in the enforcement call rather than only in the controller's log.

### Credential platform evaluated

- Its on-chain layer holds issuer registration, revocation and root freshness. **Cryptographic
  verification is off-chain by design.** The composite on-chain check is documented by its own
  authors as unsafe for a low gas stipend, so it must not sit on a transfer path.
- The pattern its authors intend for on-chain consumers is exactly the one adopted: verify once,
  write a grant with an expiry, gate on a single storage read.
- **Schemas are generic**, not identity-document specific. Corporate identity, corporate officer
  and wallet-control schemas already exist, and the schema format is interoperable with an
  established public builder.
- **Wallet attestation already supports contract signers**, which is how a custody account attests
  control of itself. The inherited `CustodyAccount` already implements the contract signature
  interface.
- Sanctions screening is already integrated.
- A full analysis of European digital identity gaps already exists, identifying wire-format and
  trust-list bridges as specified but unbuilt.

### A correction worth remembering

An early assessment claimed the credential layer had no address-to-credential binding and that
its attributes were identity-document derived. **Both were wrong.** The binding exists in the
access-issuing service, and the schema system is generic. The assessment was made from the bare
registries rather than the whole system. Read the issuing and verifying services before judging a
credential platform by its contracts.

---

## 4. Deliberately open

- ~~**Credential platform.**~~ **Selected by the owner for the pool, ADR 0028,** without the check
  of the commercial engines this item asked for. The Identity Registry keeps registrar onboarding
  until a separate decision moves it onto the protocol.
- ~~**What "multi-signature" actually is.**~~ **Decided by ADR 0016:** one established
  multi-signature wallet per institution; the controller counts institution wallets and sums their
  thresholds for Tier 2, and Tier 1 is the Agent's own wallet.
- ~~**Key recovery posture.**~~ **Decided by ADRs 0019 and 0020:** a lost institution wallet is
  replaced by every other institution after an extended timelock, with a veto for the old wallet;
  on catastrophic loss governance freezes, servicing continues on roles held apart from it, and
  the note is re-issued from the Register.
- ~~**Corporate officer presentation** pinned against entity verification rather than personal
  identity needs building.~~ **Built as the holder-wallet route** (ADRs 0045 to 0052); it waits
  on the bank's side (section 5, open from Wave 5).
- **Delegation of individuals to a custodian** needs designing.

---

## 5. Next phases

**Three spikes first.** Each is hours and each can invalidate a large part of the plan.

1. **Done, 23 September 2026.** Venue passes; instrument passes only in its own compilation
   unit as a lean custom composition. See `docs/spikes/01-contract-size.md`. Original brief:
   **EIP-170 via per-path compiler restrictions.** Gates the FX pool and covers instrument sizing
   with the same mechanism. If it fails, the pool is cut and the test network carries the note,
   deposit, registry and DvP, which is the client draft's entire scope, so the fallback costs
   nothing that was asked for.
2. **Done, 23 September 2026.** Every function maps. Six adaptations, all inside the token, bring
   the views to the Final text and remove an implicit superuser; the note is 24,364 bytes, **212
   spare**. Three obligations fall on the per-instrument gate. See
   `docs/spikes/02-compliance-interface.md`. Original brief: map every uRWA function onto a
   primitive of the debt standard, and confirm restriction values express as **non-reverting**
   views.
3. **Done as a draft, 23 September 2026.** Semantics settled in
   `docs/spikes/03-payoff-specification.md`, with an independent reference model and 25 test
   vectors in `spikes/payoff/`. **Ten items (C1 to C10) need confirmation by the Issuer and the
   Calculation Agent**; each has a default, so Wave 2 can proceed. Economics (levels, rates, dates)
   remain term sheet parameters. Original brief: settle boundary semantics and rounding direction in
   writing before any Solidity.

**Wave 1, plumbing and de-branding. Done, 24 September 2026, on `wave/1-plumbing`.**

- **Stripped to the venue.** Removed the retired identity stack and its deploy tree, the identity
  checker, the source console, the promotional token and every hosting script (tunnel, watchdog,
  hosted node), which pointed at the source deployment. The venue now runs against two fixtures
  in `test/fixtures/`: a restricted asset with the ERC-7943 fungible interface and an open cash
  leg, until Wave 2's instruments replace them. Neither is in audit scope. Cast by capacity.
- **Checker on the Final interface.** The venue checker reads `canSend` and `canReceive`, not
  the draft views it was written for. Every read fails closed, including a token with no code,
  through a checked static call. `paused()` is not in ERC-7943 and is read where present; both Wave 2
  instruments expose it.
- **Venue tests.** 15, all passing, each with a stated control; the liquidity refusal has a
  positive control so it cannot pass for the wrong reason. The README maps them.
- **Instruments unit** at `instruments/` (solc 0.8.34, legacy pipeline, `bytecode_hash =
  "none"`, which is 41 bytes smaller per contract than the spike figures). The debt standard
  submodule moved there from the spike, which now builds against the same pin and still
  reproduces 24,364 bytes and 17 tests. **Existing clones** need `git submodule sync --recursive
  && git submodule update --init --recursive` once.
- **`ops/build.sh`** builds both units, fails on any contract over EIP-170, on a missing
  submodule, and on any debt standard pin other than `v3.3.0-rc3`.
- **Chain library** at `site/lib/chain/`, carried from the console and corrected: manifest
  loading with every key checked, one price module, the audit tape, and signing by capacity with
  one queue per signer. 17 unit tests; an integration test decodes the local deployment's whole
  history and fails if any call is unrecognised. No page uses it yet. Published local keys and
  the pool-clearing nonce self-heal now apply only on the local chain.
- **Tape coverage limit.** The tape finds transactions by the events watched contracts emit, so
  a transaction that emitted none, a reverted one in particular, does not appear. Stated in the
  code. A console that must show refused attempts needs an indexer over every transaction sent
  to a watched address; decide in Wave 3.
- **Site.** Now `"type": "module"` and depends on viem. Build, typecheck and the 31 end-to-end
  checks pass. `npm audit` reports a high-severity advisory in the postcss that Next 15 bundles,
  predating this wave; the fix is Next 16, a breaking change. Not yet taken.

**Wave 2, instruments. Done, 24 September 2026.** In `instruments/`; see its README for the
contracts and sizes.

- **Identity Registry.** Grants of rights and attribute flags, jurisdiction and expiry, one
  storage slot per grant, so a check is one read (asserted under test). Written by a registrar's
  issuing key, never by the admin. Every grant expires within `maxValidity`; revocation is one
  call. The registry verifies no credential and says so.
- **Instrument gates.** Immutable, one per instrument, masks as constructor parameters. The note
  requires `HOLD`, `SANCTIONS_CLEAR` and `REG_S` at both ends; the deposit the same without
  `REG_S`. Neither restricts jurisdiction. G1 and G2 are tested, G1 by fuzzing.
- **Note and deposit** share `AdaptedToken`: spike 2's six adaptations, written once. Spike 2's
  conformance suite runs against both. The note is **24,382 bytes, 194 spare**, 18 more than the
  spike because the ERC-20 surface is resolved through the shared base. Both expose `paused()`,
  which the venue reads.
- **Deposit gateway.** Credit and debit only, each against a single-use booking reference; the
  sole minter and burner of the deposit. A debit cannot reach a frozen balance (tested).
- **Deployment** is one library used by both the deploy script and the integration tests.
  `ops/deploy-stack.sh` now ends with it. New capacities: the Access Issuer (account 2) and the
  Deposit Agent (account 9). The chain library's tape knows every Wave 2 call, and the
  integration test still requires every call on a fresh deployment to be recognised.

**Wave 2 decisions, confirmed 24 September 2026.** ADRs 0003 to 0008.

- **W1. Burns pass the gate** (spike 2, G3). Only the token's burner can burn, and the Agent can
  redeem a holder whose grant lapsed by maturity with an ordinary burn, rather than by forced
  transfer. **Wave 3 consequence:** the deposit's gate will still refuse to credit that holder,
  so the Paying Agent needs a rule for where a lapsed holder's redemption money waits.
- **W2. Supervisory withdrawal.** `IdentityRegistry.withdraw(account, reason)` removes any grant,
  whichever registrar wrote it, at once and with its written reason emitted in full. Its role is
  held by the Wave 4 controller and by no one before. Registrars still act only on their own
  participants.
- **W3. A lapsed grant stays with its registrar** until that registrar revokes it; a hand-over is
  a revoke followed by a new grant.
- **W4. The deposit stays on the debt standard,** sharing the note's adapted base, so both legs
  answer eligibility with the same code.
- **W5. Interim roles.** The deployer holds each admin role; the Agent the note's operational
  roles and the Deposit Agent the deposit's. **Upgrade, forced transfer and supervisory
  withdrawal are held by no one** until the controller exists; a test asserts it.
- **W6. Placeholders are parameters.** `NOTE_NAME`, `NOTE_SYMBOL`, `DEPOSIT_NAME`,
  `DEPOSIT_SYMBOL`, `TERM_SHEET_HASH` and `TERM_SHEET_URI` override the defaults in
  `DeployInstruments`, so naming sign-off and the final term sheet change configuration, not
  code.

**Wave 3, lifecycle. Done, 24 September 2026.** In `instruments/`; see its README.

- **Determination Agent.** Terms and calendar fixed and validated at issuance (P5, P6). A
  determination is the Calculation Agent's EIP-712 signature over the Levels and the outcome it
  computed; the contract recomputes and accepts only an identical outcome (D1). Integer formulas
  of spike 3 section 9, rounded once per CA, half up. Contract signers are supported.
- **S-34 met.** All 25 vector scenarios reproduce to the cent end to end, and seven deliberate
  payoff errors were each caught. The vectors reach Forge through
  `instruments/test/vectors/flatten.py`, which reshapes the model's output without recomputing it.
- **Record-date engine** checkpoints every balance by block timestamp (E1) and stops transfers
  (E4). **Refinement of L2:** an MER is known only once its date is determined, so transfers stop
  from the Record Time of *any* date that could redeem, and reopen once its determination shows no
  redemption. A late determination pauses trading rather than moving units whose redemption
  belongs to the seller. The stop also applies to forced transfers.
- **Paying Agent**, **DvP settlement** and the **issuance script**: see the decisions below.
  `live()` and `pending()` are derived from balances. The Calculation Agent is account 7. Dates on
  the local chain are offsets from its own clock at issuance, which closes the wall-clock hazard in
  section 6 for the local stack.
- **Tape** knows every lifecycle call; a determination reads as its outcome in euros per CA.

**Wave 3 decisions, confirmed 24 September 2026.** ADRs 0009 to 0012.

- **L1. A holder the deposit cannot credit is held for.** Its amount stays in the Paying Agent
  against it and the event, claimable by anyone for it once the deposit accepts it again. The
  event still closes for everyone else.
- **L2. The engine refuses, then the note pauses.** The engine stops ordinary transfers from the
  Record Time with no transaction needed; opening a redemption pauses the note so the ERC-7943 views
  agree. Until then the views can say yes while a transfer refuses, which is the safe direction.
- **L3. Push, verified, reconciled.** The Agent supplies holders from the Register; each holder's
  units are read from the record-date balance, never supplied; an event closes only when units
  paid equal the supply at the Record Time less the inventory.
- **L4. DvP is propose, then accept,** by the other party; either may cancel before.

**For review, taken during the build.**

- **Allowances need an onboarded spender. Resolved by ADR 0013.** The debt standard's `approve`
  refuses a spender that cannot send. The registry now has a `SETTLEMENT` right and each gate a
  settlement mask: the settlement contract may be given allowances but holds no investor attribute
  and cannot be sent units.
- **Forge's incremental build can hide a changed contract.** A test that deploys a contract kept
  its old creation code after the contract changed, so a deliberately broken payoff passed. Run
  `forge test --force` after any contract change; the instruments README says so.
- **Custody accounts as nominee (E3)** are covered in the vectors by an address, not a
  `CustodyAccount`: the custody contract is in the venue's compilation unit and cannot be deployed
  from the instruments' tests. The venue tests cover it as a holder.
- **Not in Wave 3:** reversal and restatement of a distribution (the worked example of the wrong
  record date). **Design fixed by ADR 0014** (per-holder clawback under Tier 2, then restatement);
  built in Wave 4, since it needs forced transfer on the deposit.

**Still needed from outside engineering:** confirmation of C1 to C10 by the Issuer and the
Calculation Agent (spike 3 section 10). **The positions to put to them are ADR 0015** (Proposed):
the spike's default on nine items, and **Twin Win applicable** (C5), illustratively 100% up and
100% down, capped at 150%, which the local issuance now uses. Each item is a parameter or a
clause, so a changed answer changes terms or one line, and the vector grid is regenerated.

**Wave 4, governance ceremony. Done, 25 September 2026.** Decisions are ADRs 0019 to 0026.

- **Release candidate frozen** (ADR 0026): `instruments/surface/rc1.json` defines the surface (15
  sources, 10 deployable contracts' runtime code, compiler settings, the debt standard's pin),
  tagged `instruments-surface-rc1`. `python3 ops/surface.py check instruments/surface/rc1.json`
  confirms a tree matches. **The final freeze follows confirmation of C1 to C10 and naming
  sign-off**; any change to a surface file before then is listed, with its reason, in the diff put
  to review. The venue's surface is frozen separately after Wave 5.

- **Governance controller** (13,199 bytes). Typed acts only, no calldata (ADR 0021). Tier 1 by the
  Agent's governance wallet alone: register correction and supervisory withdrawal, each with a
  reason. Tier 2 by two of three institutions whose wallets together require four signatures
  (ADR 0022), after a delay, thresholds checked again at execution: upgrade, gate replacement,
  notional amendment, reversal and restatement, registrar appointment, validity window, and
  replacing the servicing wallet as one act. Recovery replaces an institution's wallet with every
  other institution's approval and the longer delay; the old wallet can veto (ADR 0019).
- **Paying Agent** gains coupon reversal, holder by holder against the original credit by a
  reason-carrying forced transfer on the deposit, and restatement against a corrected Record Time
  (ADR 0014). The worked example of the wrong Record Time runs end to end in the tests.
- **Ceremony** (`script/Governance.sol`, `script/Ceremony.s.sol`) moves every role to its final
  holder and ends with the deployer's renunciation, verified under test and on the local chain.
- **Real wallets locally** (ADR 0024): `ops/setup-multisig.sh` installs the wallet's released code
  at its canonical addresses, checked by hash; the ceremony creates four 2-of-3 wallets whose
  signers are mnemonic indices 10 to 21, now funded by the local node. A fork-profile suite drives
  Tier 1 and Tier 2 through them.
- **Delays** are one hour and four hours locally, recorded beside the 72-hour and 14-day targets
  in the manifest (ADR 0023).
- **Tape** knows every controller act and shows a wallet transaction as the act it carried.
- **Tests:** 107 in the instruments unit, 4 against the real wallets; four deliberate controller
  errors were each caught.

**For review, taken during the build.**

- **Notional amendment is Tier 2** (ADR 0025). After the ceremony the note's mint and burn sit
  with the controller and, for redemptions only, the Paying Agent. Initial issuance happens before
  the ceremony.
- **Only coupons can be reversed** (ADR 0014). A mistaken redemption is corrected by amending the
  notional and paying through a new distribution.
- **Terms and the record-date engine are fixed for the note's life.** No one holds the note's
  terms or snapshot roles after the ceremony, and the controller has no act that grants them.
- **The gateway's and the Deposit Agent's roles are fixed.** The controller holds the gateway's
  admin role so that no one else does, but has no act that uses it.
- **Register correction is stopped by the transfer stop.** Forced transfers are ordinary
  transfers to the record-date engine (ADR 0010), so a Tier 1 correction cannot run between a
  possible redemption's Record Time and its determination.
- **The venue is not yet governed.** The venue checker and the adapter are still owned by the
  deployer key. Wave 5 pairs the pool with the deposit and puts the venue under the controller.
- **The third institution** is a placeholder wallet until it is named by capacity.

**Open items carried from the spikes and phase 0b (24 September 2026).**

- **Branch.** `spike/eip170` and `wave/1-plumbing` are merged to `main`, which is pushed to
  `origin`. `wave/5-conversion-pool` is merged to `main` through pull request 1 (28 September 2026).
- **Public domain.** The site is `https://structurednote-project.ethereumtesting.com`; production
  `SITE_URL` names it, so every emailed link carries it. `structurednote.vercel.app` is a
  permanent (308) redirect to it. `SITE_URL` is stored as sensitive, which Vercel now requires for
  production variables here, so its value cannot be read back; set it with an explicit
  `"type": "sensitive"`. Each deployment's own `*.vercel.app` address stays reachable unless
  deployment protection is turned on.
- **Mail sender.** Production `MAIL_FROM` is `Structured Note PoC <noreply@ethereumtesting.com>`,
  on the Resend domain configured 25 September 2026, and production was redeployed with it (a
  rebuild of the existing deployment, not a deploy of a branch). Confirm delivery by registering
  with an address outside the Resend account; if sends fail, check the API key is not restricted
  to another domain.
- **Rotate the Resend key** before the site carries anything real; it was pasted into a session.
- **Deploying.** From the repository root, always with `--scope ethereuminstitutional`: another
  local session also uses the Vercel CLI and changes its default scope. From `site/` the build
  fails, because it copies from `docs/`. Environment variables are set through the REST API
  (`ops/vercel-admission-env.sh`) because `vercel env add` hangs non-interactively. Run
  `npm run test:local` in `site/` before every deploy (ADR 0059).
- **Commits are GPG-signed** and need the passphrase at the keyboard.
- **Payoff confirmations C1 to C10** (`docs/spikes/03-payoff-specification.md` section 10) are
  still outstanding. Wave 3 is built on the defaults.
- **Phones.** The overview's tables stack below 640px; diagrams and the responsibilities matrix
  scroll with a cue. Any copy of the overview published before 24 September has the old layout.

**Wave 5, the conversion pool. Built 25 to 28 September 2026 on `wave/5-conversion-pool`, merged
to `main` 28 September 2026.** Decisions are ADRs 0027 to 0059.

- **Production presentation** (ADR 0027): the deposit is Euro Tokenized Deposit, `EURTD`; the note
  defaults to EUR Worst-of Autocallable Note, `EURWAN`, pending naming sign-off. Off the local node
  every name, symbol and term sheet value must be set or `DeployInstruments` stops. The router is
  `PermissionedSwapRouter`; no deployed source calls itself simulated or a stand-in.
- **Credential protocol selected** (ADR 0028) and named by capacity (ADR 0029). Its identifiers
  for the test network are in `ops/networks/base-sepolia.json`, which is not committed; the
  template beside it is.
- **Pool credential gate** (`contracts/PoolCredentialRegistry.sol`, 10,553 bytes; ADRs 0030 to
  0037). The Access Issuer attests after off-chain verification; at grant the contract checks the
  configured issuer is active, neither credential is revoked, and the attested schema, checks,
  jurisdiction (EEA, CH, GB), investor class (professional, institutional) and 30-day screening
  meet the fixed policy; grants run at most 90 days. Anyone voids a revoked credential's grant or
  suspends the gate once the issuer is deactivated; the controller withdraws with a reason. The
  swap path reads two storage slots and never calls the protocol.
- **An entity presents its corporate identity alone** (ADR 0033, amended): the screening rides
  inside it, screened at issuance, and the gate refuses a separate screening credential on that
  path. The configured issuer is now a bank issuer on the protocol's new pair of registries,
  named in the network file; the fork dry run passes against it.
- **The wallet binding is a third credential** (ADR 0043), accepted from any EVM chain for an
  ordinary wallet and from the pool's chain for a contract wallet (ADR 0042). **One presentation
  writes both grants** (ADR 0044): `script/Attest.s.sol` reads the verifier's result
  (`ops/attestations/example.json` shows the shape; real files are not committed), makes the Access
  Issuer's checks, and writes the pool grant and the Identity Registry grant.
- **Three onboarding routes** (ADR 0054), all ending in the same two grants: **custodied** (the
  default: bank staff admit a client's custody account in one action, the account signing its own
  wallet credential by EIP-1271), **self-custody through the bank** (the client signs once), and
  the **holder wallet** below. Entities are institutional by policy (ADR 0053); the officer
  credential is a gate policy, off by default.
- **Admission by QR** (ADRs 0045 to 0052, site `/onboard`, now route 3): an officer scans two codes with the
  holder wallet, the officer credential then the wallet-control credential issued to that officer;
  the site verifies each through the protocol's hosted verifier, fetches the corporation's
  corporate identity, checks the chain wallet, officer, corporation, corporate identity, and an
  operator approves before the site writes both grants. The bank, as the one configured issuer,
  verifies officers and issues all four credentials; the officer's credential is the grant's
  fourth. An integration deployment on the test network (ADR 0051) uses keys from
  `ops/new-network-keys.sh` and `ops/deploy-network.sh`; it is not the PoC execution.
- **Checker** requires both the deposit's ERC-7943 eligibility and the credential grant (ADR 0031).
- **Pool** (ADR 0038): the payment token against the deposit at par, fee 0.05%, spacing 10, one
  position from 0.995 to 1.005 by the Deposit Agent, the only liquidity provider.
- **Governed** (ADR 0039): the ceremony hands the checker and adapter to the controller, which
  gains typed venue acts. The controller is 16,815 bytes. **This changes the frozen instruments'
  surface**, as does a comment-only change to the deposit; both are listed in
  `instruments/surface/rc1-changes.md`.
- **Deploy order changed**: base (payment token, protocol), instruments, venue, activation, lens,
  custody, issuance, ceremony (`ops/README.md`). `deploy-stack.sh` now force-builds both units first,
  because an incremental build deployed a stale checker during mutation testing.
- **Protocol code locally** (ADR 0040): `ops/setup-credential-protocol.sh` installs the live
  registry implementations at their canonical addresses, checked by hash. The vendor's own
  deployment record lists older implementations.
- **Fork dry run** (ADR 0041): `ops/dry-run-fork.sh` deploys the whole stack against a fork of the
  test network's real contracts and runs the venue tests. Its four findings are in ADR 0041.
- **Tests** (rerun 28 September 2026). Venue: 53 (17 pool, 6 custody, 30 gate). The pool and
  custody suites read the local deployment, so run them with `--fork-url http://127.0.0.1:8545`;
  a plain `forge test` fails them. Also 23 against the fork dry run. Instruments: 115, and 4 on
  the real wallets. Site: 59 unit, 8 admission and 6 browser tests, and 2 chain tests; the tape
  knows every Wave 5 call. Seven deliberate errors in the gate, one in the checker and four in the
  controller's venue acts were each caught.

**Admission, built 26 to 28 September 2026** (site `/onboard` and `/operator`; ADRs 0053 to 0059).

- **Route 1, custodied: live on the test network.** Bank staff choose the client from the bank's
  own corporate identities and give the custody account and instruction references. One action
  then:
  - opens the custody account;
  - has it sign the bank's wallet-control challenge (EIP-1271), for which the bank mints the
    wallet credential;
  - writes both grants;
  - sets the Permit2 approvals.

  Two custody accounts are admitted: `0x19436e7b1943BD10330051943fE19539e5da1C38` and
  `0x10e396d563f007c7E8D2b5c8CA0BAa1f716B1ABE`. The second's approvals failed on a lagging RPC
  and were finished with **Set trading approvals**. The approvals now wait until the deposit
  itself holds the account as eligible, and the grants are recorded before the approvals.
- **Route 2, self-custody through the bank: built and tested locally.** The client asks for its
  KYB to be confirmed and types nothing (ADRs 0056 and 0057). Staff confirm it by choosing the
  client's reference. The client then names a wallet and signs the bank's challenge once, from a
  browser wallet or by pasting a signature. A failed signature leaves the KYB confirmed.
- **Route 3, holder wallet: built, waiting on the bank** (open items below).
- **The bank** is reached with a service key, `sk_...`, sent only to the bank's own origin (ADR
  0055). The key in use carries more scopes than the site needs; the owner chose to keep it. The
  bank sends integers in typed data as decimal strings, so the site signs them as numbers
  (`normaliseTypedData`).
- **Clients are entered once** (ADR 0066). Under Operator → Clients, staff add a corporate client's
  facts. The site has the bank's issuer server sign and anchor them as its corporate identity
  (`credentials:issue`), and keeps the claims. Routes 1 and 2 then take only the client and, for
  custody, two references. **Re-screen** issues again when the 30-day screening lapses.
- **References are the site's** (ADR 0067), and **browser wallets bind in one click** (ADR 0068).
  MetaMask supplies the address, is switched to the pool's chain or has it added, and signs the
  bank's message. This applies on route 2, and on route 3 after the officer's scan, where the bank
  issues the wallet credential to the officer. The older ways remain, folded away.
- **Convert** (ADR 0070; S-27, S-28).
  - An onboarded wallet converts EURC and EURTD both ways from the Onboard page in MetaMask, with
    one-time approvals, a quote, and a 0.5% minimum-received.
  - Staff convert for custody accounts and credit EURTD through the gateway from the Operator page.
  - The quote maths is unit-tested; conversions are tested on the local chain through the lagging RPC.
- **One wallet per KYB** (ADR 0069). Admitting a wallet offboards the client's previous one, on
  any route. An onboarded client sees **Bind a new wallet**, with no second review, and the Onboard
  page shows three stages. MetaMask is always asked to switch to the pool's chain just before
  signing: with networks per site, the chain it reports is not always the one it signs on.
- **Offboarding and revocation** (ADRs 0063, 0064). **Offboard** revokes both grants, with a
  reason. **Revoke at the bank** revokes the wallet credential, or the corporate identity as its
  own confirmed step.
- **Grants wait for anchoring** (ADR 0060). On every route, the grants are written only once each
  credential they rest on is anchored in the bank's registry: reported by the bank, and its
  `updateRoot` transaction checked on-chain. The admission shows `awaiting-anchor` for about a
  minute meanwhile. An inclusion proof for each credential is still to come from the protocol.
- **The site looks like the organisation's event pages** (ADR 0061), with a crimson icon.
- **Clients can cancel** at any step until grants are being written (ADR 0058). Staff are warned
  before submitting a jurisdiction outside the pool's 32, or a screening date in the future or
  older than 30 days.
- **Testing is local only** (ADR 0059; `npm run test:local` in `site/`):
  - browser tests click through a production build of each route;
  - `test/lagging-rpc.ts` answers reads from a block behind just after a receipt, which
    reproduces the lagging-RPC failure;
  - `test/standins.ts` plays the bank and the verifier, including their known quirks.

  Nothing is tested on a public chain.

- **Integration deployment on Base Sepolia, 26 September 2026** (ADR 0051; not the PoC execution).
  Keys in `ops/keys.base-sepolia-integration.env`, manifest in `ops/addresses.base-sepolia.json`,
  both not committed. Deposit 0x5Ef2c420518135f8A6E6daB15dEAA63B44718957, note 0xc48Dc039b8fDBC283Ae37c3495C12b0bE5d179c7,
  pool credential gate 0xb4eC55923689FE8dDf12926D392Dc9b8eC0661a9, Identity Registry 0x95dB878cd374b55ff672A3E597ab207fd8FCCA05,
  controller 0xbC224b2F963162a5bD5bB9aF27916f39BCBEcA5f. The pool holds about 20 of each token (the faucet's limit);
  the note carries the placeholder term sheet reference. The cast's own grants rest on reference
  identifiers, not issued credentials; real admissions go through the site.
  `ops/vercel-admission-env.sh` sets the site's admission settings from these files.

**For review, taken during the build.**

- **Force-closing a liquidity position is not a controller act** (ADR 0039): proceeds the provider
  could not receive would sit with the controller as a claim nothing can move.
- **Custody accounts' registry grants and pool admission** now happen in the custody script, and
  references are neutral (`SEG-0001`, `ONB-0001`, `CRD-0001`).
- **The payment token cannot be minted on a fork**; the dry run writes balances to its storage and
  reads them back.

**Open, from Wave 5.**

- **Route 3 needs three things on the bank's side.** The request has gone to the credential
  protocol's operator:
  - its verifier must accept the wallet-control schema in verifier requests;
  - it must issue officer credentials, with the wallet-control credential issued to the same
    officer;
  - each corporation must publish its corporate identity at `/v1/issuer/corporate-identity`.

  When it is done, put the real responses into `test/standins.ts` and run the browser tests
  before scanning for real.
- ~~**Test credentials** (ADR 0041).~~ The bank issuer now issues corporate identities and
  wallet-control credentials on the test network; route 1 runs on them.
- **S-36 must be narrowed for the person path** (ADR 0034): attested residence jurisdiction and
  investor class are in the grant transaction's input.
- ~~**Contract-signer wallet control** (ADR 0036).~~ Confirmed live: custody accounts attest by
  EIP-1271 on the test network.
- **The local node's published keys carry EIP-7702 delegations on the test network.** A live
  deployment needs a key per capacity (Wave 6).
- Root freshness stays off (ADR 0035).
- ~~**The corporate identity schema needs an investor class.**~~ Entities are institutional by
  policy (ADR 0053). On the bank's routes the screening date is the bank's own, stated by its
  staff. On route 3 it is the credential's issuance time, so a corporate identity older than 30
  days must be re-issued first.
- **The protocol's registrar role is global over every issuer** (ADR 0028). Scope it before any
  registrar outside the protocol operator holds it.
- ~~A wallet-control credential is being built in the protocol.~~ Built and in use (ADR 0043).
- **Rotate the Resend key** (above) and consider Next 16 for the postcss advisory (Wave 1).

**Then, in order.** Freeze the venue's surface. The final freeze of the
instruments once C1 to C10 and naming are confirmed. Wave 6, hardening and deployment.

Two gates sit outside engineering and should start now: the **independent audit** and **token
naming sign-off**. Neither blocks building; both block executing.

---

## 6. Hazards inherited from the source repository

Struck items were closed in Wave 1.

- ~~`ADMIN_EMAIL_DOMAIN` defaults to the original vendor's domain.~~ Removed with the console. The
  site names operators by explicit list only, with no default and no domain rule.
- ~~The health watchdog probes for a literal copy string in a page.~~ Removed with the hosting
  scripts.
- ~~The activity feed is keyed by function name alone and silently drops unmapped rows.~~ Replaced
  by `site/lib/chain/tape.ts`: keyed by target contract and selector, unrecognised calls kept and
  marked. See the tape coverage limit in section 5.
- ~~A numeric-formatting heuristic breaks at low decimals and truncates long strings.~~ Amounts
  use their own token's decimals; text is never truncated.
- ~~Price maths hardcodes a decimal gap and is copy-pasted in two files.~~ One module,
  `site/lib/chain/price.ts`, with decimals from the manifest.
- ~~The pool's opening price assumes the asset sorts first.~~ Fixed early, since the script was
  rewritten anyway: `02_ActivateVenue` derives the price from the actual order and both tokens'
  decimals. Verified by redeploying until the cash leg sorted first; all tests pass with either
  order.
- ~~`poolId` takes the whole manifest, encoding one pool.~~ It takes a pool key.
- The holder cast is no longer a hand-assembled literal: parties are a map in the manifest,
  written by `00_DeployStandIns`. It still carries only addresses; **the fields the registrar split
  and holder roll need are Wave 3 design**.
- ~~Four documents each restate the deploy phase count and all four are wrong.~~ The sequence is
  written once, in `ops/README.md`, which defers to `ops/deploy-stack.sh`.
- Wall-clock coupon and record dates against any baked or restored chain state. The local
  issuance dates the schedule from the chain's own clock, and there is no baked state any more. A
  public test network deployment fixes real dates at issuance, which is correct there.
- The address manifest has a size ceiling as a hosting environment variable. The chain library
  prefers a file (`MANIFEST_PATH`); a hosted console still needs a home for it.
- **Submodules are not checked out** in a fresh clone. Nothing compiles until they are
  initialised; `ops/build.sh` names the first one missing.
- **`vercel integration add` writes agent skill files into the repository** (`.agents/skills/`,
  symlinks under `.claude/skills/`, and `skills-lock.json`), unrequested and vendor-named. Delete
  them after any integration install.
- ~~The local node runs with a raised code-size limit.~~ Removed in spike 1; every node start
  now enforces the standard limit.

---

## 7. Positions worth keeping intact

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
- **Eligibility is established cryptographically, recorded on-chain, bounded in time, and
  revocable immediately.** Do not upgrade this to "verified on-chain at every transfer", which is
  false and is the sort of claim a reviewer tests.
- **Settlement finality in a contract is not legal finality**, which is conferred by the register
  update. Never conflate them in an external document.
- **No cryptocurrency is involved.** Network fees are paid in valueless faucet units, which is
  stated rather than hidden.
