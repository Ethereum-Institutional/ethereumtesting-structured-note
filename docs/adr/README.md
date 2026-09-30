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
| [0028](0028-credential-protocol-selected.md) | The credential protocol is selected, for the conversion pool first | Accepted (Wave 5) |
| [0029](0029-vendors-by-capacity.md) | Vendors are named by capacity; their identifiers live in a network file | Accepted (Wave 5) |
| [0030](0030-pool-credential-gate.md) | The pool has its own credential gate: verify off-chain, check issuer and revocation on-chain, gate on one read | Accepted (Wave 5) |
| [0031](0031-pool-requires-both.md) | The pool requires both the deposit's eligibility and a live credential grant | Accepted (Wave 5) |
| [0032](0032-fixed-policy-per-gate.md) | The policy is fixed at construction, one gate per policy, with one configured issuer | Accepted (Wave 5) |
| [0033](0033-participant-paths-and-attributes.md) | Two participant paths, entity and natural person, on the protocol's own schema fields | Accepted (Wave 5) |
| [0034](0034-attributes-checked-on-chain.md) | The attester's attribute values are checked against the policy on-chain | Accepted (Wave 5) |
| [0035](0035-grant-lifetime.md) | A grant runs to the earlier of the credential's expiry and a maximum validity; root freshness is off by default | Accepted (Wave 5) |
| [0036](0036-contract-wallets-admitted.md) | Contract wallets are admitted by their own signature, so custody accounts can be granted | Accepted (Wave 5) |
| [0037](0037-grant-authority.md) | Grants are written by the Access Issuer, withdrawn under supervision, and voided by anyone on revocation | Accepted (Wave 5) |
| [0038](0038-pool-configuration.md) | Pool configuration: the euro payment token against the deposit, near par, one liquidity provider | Accepted (Wave 5) |
| [0039](0039-venue-under-the-controller.md) | The venue is governed through typed controller acts | Accepted (Wave 5) |
| [0040](0040-protocol-code-locally.md) | The local stack installs the protocol's released registry code at its canonical addresses | Accepted (Wave 5) |
| [0041](0041-fork-dry-run-first.md) | Wave 5 is built locally and dry-run against a fork of the test network; the live deployment waits | Accepted (Wave 5) |
| [0042](0042-wallet-control-across-chains.md) | Wallet control is accepted from any EVM chain for ordinary wallets, and from the pool's chain for contract wallets | Accepted |
| [0043](0043-wallet-credential-checked-on-chain.md) | The wallet-control credential is a third credential, checked on-chain | Accepted |
| [0044](0044-one-presentation-two-grants.md) | One verified presentation writes both the pool grant and the Identity Registry grant | Accepted |
| [0045](0045-presentation-by-qr.md) | Participants present credentials by scanning a QR code with the holder wallet | Accepted |
| [0046](0046-officer-presents-for-entity.md) | For an entity, an authorised officer presents | Accepted |
| [0047](0047-hosted-verifier-for-poc.md) | The protocol's hosted verifier gives the verdict for the PoC; the Access Issuer runs its own before execution | Accepted |
| [0048](0048-operator-approves-admission.md) | An Access Issuer operator approves each admission; the site then signs both grants | Accepted |
| [0049](0049-officer-credential-on-chain.md) | The officer's credential is a fourth credential, required on the entity path | Accepted |
| [0050](0050-wallet-credential-to-officer.md) | The wallet-control credential is issued to the officer who presents | Accepted |
| [0051](0051-integration-deployment.md) | An integration deployment on the test network, separate from the PoC execution | Accepted |
| [0052](0052-bank-verifies-officers.md) | The bank verifies the officer structure and issues officer credentials; changes wait for notice or the periodic refresh | Accepted |
| [0053](0053-entities-institutional-by-policy.md) | Entities admitted on the bank's KYB are institutional by policy | Accepted |
| [0054](0054-three-onboarding-routes.md) | Three routes into the pool: custodied by default, self-custody through the bank, and the holder wallet | Accepted |
| [0055](0055-service-key-for-the-bank.md) | The site reaches the bank's issuer with a scoped service key, not a staff session | Accepted |
| [0056](0056-kyb-first-then-bind.md) | Self-custody: the bank confirms the client's KYB first, then the client binds a wallet with one signature | Accepted |
| [0057](0057-bank-holds-the-client-reference.md) | The bank holds the client's reference; staff choose it from the bank's list, and the client never types it | Accepted |
| [0058](0058-client-can-cancel.md) | A client can cancel its admission at any step until the grants are being written | Accepted |
| [0059](0059-test-locally-at-the-seams.md) | Test the pages and the network's behaviour on the local chain, before every deploy | Accepted |
| [0060](0060-grant-only-anchored-credentials.md) | Grants rest only on credentials anchored in the bank's registry, on every route | Accepted |
| [0061](0061-house-style.md) | The site takes the house style of the organisation's event pages, with a crimson icon | Accepted |
| [0062](0062-client-routes-stay-open.md) | A client can always onboard another wallet; the bank's custodied admissions never block it | Accepted |
| [0063](0063-offboard-by-revoking-both-grants.md) | Staff offboard an account by revoking both of its grants, with a written reason | Accepted |
| [0064](0064-revoke-at-the-bank-separately.md) | Revoking at the bank is separate from offboarding, and the corporate identity is its own confirmed step | Accepted |
| [0065](0065-new-clients-at-the-bank.md) | New corporate clients are added in the bank's own console, linked from the Operator page | Superseded by 0066 |
| [0066](0066-site-issues-client-identities.md) | The site is the bank's onboarding system: staff enter a client once, and the issuer server signs and anchors it | Accepted |
| [0067](0067-site-assigns-references.md) | The site assigns client and custody references | Accepted |
| [0068](0068-browser-wallet-binds-in-one-click.md) | A browser wallet binds in one click: address read, chain switched or added, message proposed | Accepted |
| [0069](0069-one-wallet-per-kyb.md) | One wallet per KYB, a new wallet replaces the old, and the Onboard page shows three stages | Accepted |
