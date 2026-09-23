# Spike 2. Compliance interface on the debt standard

Status: complete, 23 September 2026. Outcome: **passes with six adaptations**, all inside the
token, measured and tested. The adapted note is 24,364 bytes, **212 spare**.

The question was whether every function of ERC-7943 maps onto a primitive of the debt
standard, and whether the restriction views are genuinely non-reverting. They map. As shipped,
three of the views do not meet the Final text, and one inherited access rule contradicts the
two-tier model. Each is closed by a small override in the composing contract from spike 1.

The reference is ERC-7943 as published with status Final. The debt standard ships its own copy
of the interface marked as a draft; the function set, events and errors match the Final text,
so no signature adaptation is needed.

---

## 1. Mapping

| ERC-7943 | Primitive in the debt standard | As shipped | Adapted |
|---|---|---|---|
| `supportsInterface(0x3edbb4c4)` | Access control base | Conforms | |
| `canSend`, `canReceive` | Validation module | **Freeze status only.** Eligibility is never consulted | Freeze status and the gate's answer |
| `canTransfer` | Rule engine base | Unfrozen amount, pause, frozen ends, then the gate. **Can revert** | Gate queried without possibility of revert; ends tested with `canSend`/`canReceive` |
| `getFrozenTokens` | Enforcement module | Conforms | |
| `setFrozenTokens` | Enforcement module | Conforms. May exceed balance; emits `Frozen` | |
| `forcedTransfer` (three arguments) | Enforcement module | Event order conforms. **No receive check.** Held by the admin role | Receive check; dedicated role |
| `forcedTransfer` with reason payload | Securities enforcement extension | As above, and carries the reason in its event | As above |
| Events and errors | Enforcement and validation modules | Names and fields match the Final text | |
| Public transfers must not succeed where the views say no | Rule engine callback on every transfer | Depends on the gate | Gate obligation G1 |
| Mint respects `canReceive` | Same callback, with no sender | Depends on the gate | Gate obligation G1 |

## 2. What was wrong, and the fix

### A1. Eligibility never reached `canSend` and `canReceive`

The account views test only whether the address is frozen. Eligibility lives in the
per-instrument gate, which the standard models as a rule engine, and the rule engine interface
has no account-level query. An account with no grant was reported as able to receive, while a
transfer to it would revert. A venue integrating against the views, which is the stated purpose
of adopting the interface, would be told the wrong thing.

Fix: the gate interface adds `canSend(account)` and `canReceive(account)`, and the token answers
both as "not frozen and the gate agrees".

### A2. The views could revert

`canTransfer` calls the gate as an ordinary external call. A gate that reverts, runs out of gas,
returns malformed data, or has no code at the address makes `canTransfer` revert. The Final text
says it MUST NOT. A `try` block does not close this: a malformed return or an address without
code still reverts in the caller.

Fix: every gate query goes through one internal function that makes a static call with a gas
bound, accepts only a 32-byte return equal to exactly `1`, and answers false in every other
case. The views therefore fail closed and cannot revert. The bound is 100,000 gas; the gate's
design is a single storage read per check, so the bound is two orders of magnitude of headroom.

### A3. Forced transfer could deliver to an ineligible holder

Forced transfer bypasses the transfer rules entirely, including the receive check that the
Final text says it SHOULD make. A forced transfer could therefore make an ineligible account the
holder of record.

Fix: forced transfer reverts unless the recipient passes `canReceive`. Burning by forced transfer
(recipient zero) is unaffected. Freezes on the sender are still overridden, which is the purpose
of the function, and the `Frozen` event is still emitted before the transfer event, as required.

### A4. The admin role silently held every role

The standard's access control overrides `hasRole` so that the default admin passes every role
check: forced transfer, upgrade, mint, freeze, and replacement of the gate. A dedicated role for
forced transfer means nothing while that holds, and it collapses the distinction between Tier 1
and Tier 2 (D13) into whoever holds the admin role.

Fix: `hasRole` is restored to plain semantics. The admin administers roles and holds only those
it was granted. It can still grant itself a role, but only by a transaction that emits
`RoleGranted`, so the act is on the record rather than implicit. This override removes code and
made the contract smaller.

### A5. Forced transfer moves to its own role

The standard assigns forced transfer to the default admin. It now has `FORCED_TRANSFER_ROLE`,
held by the controller. The controller's fixed selector set calls only the reason-carrying form,
so the three-argument form required by the interface exists, is restricted to the same role, and
is unreachable in operation.

### A6. Mints and burns in `canTransfer`

The Final text counts any operation emitting the transfer event as a transfer. The adaptation
tests only the real ends: a mint has no sender to test, a burn no recipient.

## 3. Obligations on the per-instrument gate

The token now depends on the gate for correctness. These obligations are written here so that
the gate is built and tested against them.

- **G1. The callback agrees with the views.** The gate's transfer callback reverts whenever its
  `canTransfer` would answer false, and its `canTransfer` answers false whenever `canSend(from)` or
  `canReceive(to)` would. On a mint the callback applies `canReceive` to the recipient. This is what
  makes "public transfers must not succeed where the views say no" true.
- **G2. The views are cheap and bounded.** Well within 100,000 gas. Above that the token answers
  false for every account, which fails safe but halts the instrument's views.
- **G3. Burns at redemption.** The standard's burn runs through the same callback, so a holder
  whose grant has lapsed by maturity cannot be redeemed by ordinary burn. Either the gate permits
  a burn by the Agent regardless of the holder's grant (the Final text allows permissioned burns to
  bypass `canSend`), or redemption of such holders uses forced transfer to zero. This is a Wave 3
  decision; it is recorded here because grant expiry makes it certain to arise at maturity.

## 4. Other findings

- The reason-carrying freeze cannot exceed the balance; only the interface's `setFrozenTokens`
  can, and it carries no reason. Pre-freezing future balances is therefore possible only without a
  written reason. Not needed by any scenario in the solution overview; recorded in case one is.
- Minting and burning remain possible while the instrument is paused, but not once it is
  deactivated. Deactivation requires a prior pause and is one-way.
- The deposit token is also specified to carry ERC-7943. It needs the same adaptations A1 to A5 on
  whatever composition it uses; it carries no snapshot or holder enumeration, so it has more room.

## 5. Evidence

Seventeen tests, run against the lean composition from spike 1 behind an ERC-1967 proxy, with a
mock gate that can be switched into five failure modes (revert, out of gas, long return, non-boolean
return, empty return) and an address with no code.

Four against the composition as the standard provides it, each confirming a defect: an ineligible
account reported as able to receive; `canTransfer` reverting when the gate reverts; `canTransfer`
reverting when the gate returns malformed data; forced transfer delivering to an ineligible account.

Thirteen against the adapted composition, all passing: the interface identifier; account views
under eligibility and freezing; all three views returning false without reverting under every
failure mode and against an address with no code; `canTransfer` against unfrozen amount, pause,
send and receive, and not against balance alone; mint and burn ends; public transfer consistent
with `canTransfer`; mint to an ineligible account reverting; freezing beyond balance; the admin
holding no role it was not granted; forced transfer refused without the dedicated role in both
forms; forced transfer refused to an ineligible recipient; and forced transfer from a frozen
account emitting `Frozen`, then the transfer event, then `ForcedTransfer`, with the written reason
carried intact in the securities enforcement event.

| Composition | Runtime bytes | Spare |
|---|---|---|
| Lean, guarded (spike 1) | 24,004 | 572 |
| Adapted | 24,364 | 212 |

As with spike 1, the composition and test sources are kept outside this repository because they
carry the standard's identifiers. They become Wave 2 code when the dependency is added.
