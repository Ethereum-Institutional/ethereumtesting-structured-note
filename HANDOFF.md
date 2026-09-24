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
component linked into the overview. Postgres is Neon in Frankfurt. Mail is Resend with a
sending-only key; **delivery waits on the sending domain's DNS verification**, and until then a
registration returns "Email delivery is unavailable". 27 end-to-end checks pass locally. The
domain rule's list and the operator list live only in the Vercel environment, not in this
repository. See `site/README.md`. No contracts and no chain are deployed.
The repository is a clone of the source demo with history preserved. **Wave 1 has stripped it to
the venue** (section 5); nothing of the retired identity stack, the source console or the source
hosting remains in the tree, only in history.

`origin` is a **private** repository under the owner's personal account
(`benjaminchodroff/structured-note-poc`), created 24 September 2026. `upstream` still points at
the source demo for reference, with its push URL set to `DISABLED` in the local clone, so nothing
can be pushed there by accident. That setting is local: repeat it in any new clone that adds
`upstream`.

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

- **Credential platform.** Three routes documented with strengths and costs. The deciding input is
  expected to be distribution, not technology. Verify the current status of the commercial
  compliance engines and of any revision to the incumbent securities-identity standard before
  deciding; that space moves quickly.
- **What "multi-signature" actually is.** Named in several places, never specified. It affects
  audit scope, ceremony design and whether signers can use hardware wallets. Settle before the
  ceremony work.
- **Key recovery posture.** The deploying key renounces its rights, so the multi-signature becomes
  the only upgrade path. If its signers are lost, the contracts are frozen. Choose and record.
- **Corporate officer presentation** pinned against entity verification rather than personal
  identity needs building.
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
  through a checked static call. `paused()` is not in ERC-7943 and is read where present: **the
  Wave 2 instruments must expose it**, or a pause will not register at the venue.
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

**Open items carried from the spikes and phase 0b (24 September 2026).**

- **Branch.** `spike/eip170` and `wave/1-plumbing` are merged to `main`, which is pushed to
  `origin`.
- **Mail sender is temporary.** Production `MAIL_FROM` is Resend's shared test sender, which
  delivers only to the Resend account owner. Once the sending domain verifies in Resend (DNS is
  pending on the DNS provider), set `MAIL_FROM` to `Structured Note PoC
  <access@ethereuminstitutional.org>` and redeploy. Until then, nobody else receives links.
- **Rotate the Resend key** before the site carries anything real; it was pasted into a session.
- **Deploying.** From the repository root, always with `--scope ethereuminstitutional`: another
  local session also uses the Vercel CLI and changes its default scope. Environment variables were
  set through the REST API because `vercel env add` hangs non-interactively.
- **Commits are GPG-signed** and need the passphrase at the keyboard.
- **Payoff confirmations C1 to C10** (`docs/spikes/03-payoff-specification.md` section 10) should
  go to the Issuer and the Calculation Agent early; Wave 3 depends on them.
- **Phones.** The overview's tables stack below 640px; diagrams and the responsibilities matrix
  scroll with a cue. Any copy of the overview published before 24 September has the old layout.

**Then, in order.** Wave 2,
instruments. Wave 3, lifecycle. Wave 4, ceremony, then **freeze and tag the contract surface**.
Wave 5, FX pool. Wave 6, hardening and deployment.

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
- Wall-clock coupon and record dates against any baked or restored chain state. Store the schedule
  as offsets, or ship a re-time action.
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
