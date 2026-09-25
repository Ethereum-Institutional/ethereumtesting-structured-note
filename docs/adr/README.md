# Architecture decision records

One decision per record: its context, the options considered, the decision, why it won, and its
consequences. See ADR 0001 for the practice. Decisions D1 to D17 predate it and are in
HANDOFF.md section 2.

A decision owned by a party outside engineering is **Proposed** until that party confirms it.

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-strip-the-inherited-console.md) | Strip the inherited console, keep its chain plumbing | Accepted (Wave 1) |
| [0003](0003-burns-pass-the-gate.md) | Burns pass the instrument gate | Accepted (Wave 2, W1) |
| [0004](0004-supervisory-withdrawal.md) | Supervisory withdrawal from the registry | Accepted (Wave 2, W2) |
| [0005](0005-lapsed-grant-ownership.md) | A lapsed grant stays with its registrar | Accepted (Wave 2, W3) |
| [0006](0006-deposit-on-the-debt-standard.md) | The deposit shares the note's debt-standard base | Accepted (Wave 2, W4) |
| [0007](0007-controller-powers-held-by-no-one.md) | Controller powers are held by no one until the controller exists | Accepted (Wave 2, W5) |
| [0008](0008-placeholders-as-parameters.md) | Names, symbols and the term sheet are deploy parameters | Accepted (Wave 2, W6) |
| [0009](0009-unpayable-holders-are-held-for.md) | A holder the deposit cannot credit is held for | Accepted (Wave 3, L1) |
| [0010](0010-transfer-stop-at-redemption.md) | Stop transfers at a possible redemption's Record Time | Accepted (Wave 3, L2) |
| [0011](0011-distribution-push-verified-reconciled.md) | Distributions are pushed, verified and reconciled on-chain | Accepted (Wave 3, L3) |
| [0012](0012-dvp-propose-accept.md) | DvP settlement is propose, then accept | Accepted (Wave 3, L4) |
| [0013](0013-settlement-right-for-infrastructure.md) | A settlement right for infrastructure spenders | Accepted |
| [0014](0014-reversal-by-per-holder-clawback.md) | Reversal is a per-holder clawback, then restatement | Accepted (built in Wave 4) |
| [0015](0015-payoff-positions-c1-c10.md) | Positions on payoff confirmations C1 to C10 | Proposed: for confirmation by the Issuer and the Calculation Agent |
| [0016](0016-multi-signature-one-wallet-per-institution.md) | Multi-signature is one wallet per institution | Accepted (built in Wave 4) |
| [0017](0017-audit-tape-keyed-by-target.md) | The audit tape is keyed by target and never drops a row | Accepted (Wave 1, during the build) |
| [0018](0018-venue-checker-reads-final-views.md) | The venue checker reads the Final ERC-7943 views and fails closed | Accepted (Wave 1, during the build) |
| [0019](0019-recovering-a-lost-institution-wallet.md) | A lost institution wallet is replaced by the others, slowly, with veto | Accepted (built in Wave 4) |
| [0020](0020-catastrophic-loss-posture.md) | On catastrophic loss, governance freezes, servicing continues, and the note is re-issued | Accepted (separation built in Wave 4; runbook in Wave 6) |
| [0021](0021-typed-actions-no-calldata.md) | The controller's fixed action set is typed actions, with no calldata | Accepted (Wave 4) |
| [0022](0022-tier2-three-institutions.md) | Tier 2 is two of three institutions and at least four signatures | Accepted (Wave 4) |
| [0023](0023-timelocks-as-parameters.md) | Timelocks are parameters: 72 hours and 14 days, compressed for the PoC | Accepted (Wave 4) |
| [0024](0024-real-wallets-locally.md) | The local stack runs the real multi-signature wallet | Accepted (Wave 4) |
| [0025](0025-separate-servicing-wallet.md) | The Agent runs a separate servicing wallet | Accepted (Wave 4) |
| [0026](0026-freeze-candidate-then-final.md) | Freeze the instruments as a release candidate now, finally after confirmation | Accepted (Wave 4) |
| [0027](0027-production-presentation-on-chain.md) | What is written on-chain reads as production, and a public deployment sets it explicitly | Accepted (Wave 5) |
