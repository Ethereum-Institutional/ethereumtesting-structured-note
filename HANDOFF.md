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

**Phase 0b is built and tested locally** in `site/`: registration with email verification and
operator approval, everything gated, the architecture as the signed-in home page with each
component linked into the overview. 24 end-to-end checks pass. See `site/README.md`. No contracts
and no chain are deployed.
The repository is a clone of the source demo with history preserved; the strip-to-the-venue
commit has **not** been made yet.

The remote is named `upstream` and points at the source demo, deliberately. There is no `origin`,
so nothing can be pushed to the source repository by accident. Set an `origin` when a home for
this repository exists.

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

**Then, in order.** Phase 0b, the gated landing site. Wave 1, plumbing and de-branding. Wave 2,
instruments. Wave 3, lifecycle. Wave 4, ceremony, then **freeze and tag the contract surface**.
Wave 5, FX pool. Wave 6, hardening and deployment.

Two gates sit outside engineering and should start now: the **independent audit** and **token
naming sign-off**. Neither blocks building; both block executing.

---

## 6. Hazards inherited from the source repository

- `ADMIN_EMAIL_DOMAIN` **defaults to the original vendor's domain**. This is a live access-control
  issue, not cosmetic. Fix during de-branding.
- The health watchdog probes for a literal copy string in a page. Replace with a purpose-built
  marker **in the same commit** as the page edit, or it silently disables itself.
- The activity feed is keyed by function name alone and **silently drops unmapped rows**. With two
  ERC-20-shaped tokens, mint, burn and transfer are ambiguous. An audit tape that is quietly
  incomplete is the worst possible failure for this audience.
- A numeric-formatting heuristic in the same file breaks at low decimals and truncates long
  strings to twelve characters, which would cut an intervention reason mid-sentence.
- Price maths hardcodes a decimal gap and is **copy-pasted in two files**, not imported.
- **The pool's opening price assumes the asset sorts first.** `02_ActivateVenue` orders the
  currencies by address but initialises with a constant computed for the asset as `currency0`.
  When the stablecoin sorts first the pool opens at an inverted price and swaps return zero.
  Local addresses are deterministic and happen to sort the safe way, so the tests pass; a retry
  on a non-fresh node in spike 1 produced the other order and two swap tests failed. On a public
  network this is a coin toss. Derive the price from the actual order in Wave 5.
- `poolId` takes the whole manifest, encoding one pool.
- The holder cast is a hand-assembled literal that cannot carry the fields the registrar split and
  holder roll need.
- Four documents each restate the deploy phase count and all four are wrong.
- Wall-clock coupon and record dates against any baked or restored chain state. Store the schedule
  as offsets, or ship a re-time action.
- The address manifest is passed as a hosting environment variable and has a size ceiling it will
  approach.
- **Submodules are not checked out.** Nothing compiles until they are initialised.
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
