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
| [0070](0070-convert-in-the-pool.md) | Converting in the pool: both kinds of wallet, one-time approvals, faucets plus a bank credit, and a 0.5% limit | Accepted |
| [0071](0071-the-ledger.md) | The Ledger: the lifecycle from the chain alone, through Alchemy, with a register reconciliation for staff | Accepted |
| [0072](0072-demonstration-notes.md) | Demonstration notes: a second note on the same code, a calendar chosen at issuance, scenario levels, site-held test keys, and Reg S approval per client | Accepted |
| [0073](0073-operator-console-and-note-calendars.md) | The Operator console in sections, "notes" without qualification, and a calendar configured by observations and interval | Accepted |
| [0074](0074-third-party-wallets.md) | The self-custody route is shown as Third party | Accepted |
| [0075](0075-reg-s-approval-and-placement.md) | Approval for the note under Reg S, and placement by DvP from the site | Accepted |
| [0076](0076-onboard-console.md) | The client's Onboard pages: a navigation column, an account card, unbinding, and asking for custody | Accepted |
| [0077](0077-unconfirmed-registrations.md) | Unconfirmed registrations: staff resend the link, or approve ahead of confirmation | Accepted |
| [0078](0078-determinations-payments-closure.md) | Determinations, payments and closure from the site, one step at a time | Accepted |
| [0079](0079-chain-snapshots-for-tests.md) | Local resets restore a snapshot of the deployed chain | Accepted |
| [0080](0080-eth-for-fees.md) | ETH for fees: a Keys page, a check before every transaction, and top-ups | Accepted |
| [0081](0081-locked-settlement-and-trading.md) | Locked settlement: offers that lock their side, transfers arranged or open, buy-backs, and cancelling from the inventory | Accepted |
| [0082](0082-governance-console-and-expiry.md) | Governance from the site, and an execution window for Tier 2 proposals | Accepted |
| [0083](0083-records-scoped-to-a-deployment.md) | Records scoped to a deployment, for a fresh deployment of the test network | Accepted |
| [0084](0084-close-out-statement.md) | A close-out statement for a redeemed note, read from the chain | Accepted |
| [0085](0085-t-rex-release-and-scoped-agents.md) | T-REX 5.0.0-beta2 with ONCHAINID 2.2, and agents limited to what each needs | Accepted |
| [0086](0086-deposit-token-allowlist.md) | The tokenized deposit: an allowlist ERC-20 like JPMD, eligible by the bank's own identity registry | Accepted |
| [0087](0087-licence-boundary.md) | A narrow GPL-3.0 boundary around T-REX, and no non-commercial modules | Accepted |
| [0088](0088-erc-3643-core.md) | The note as an ERC-3643 token: identities, claims by role, record dates as compliance, and restricted agents | Accepted |
| [0089](0089-onboarding-by-role.md) | Onboarding by role: five portals, custody routes on identities, and no credential platform | Accepted |
| [0090](0090-pool-on-identities.md) | The conversion pool, on by default, gated on the same ONCHAINID identities | Accepted |
| [0091](0091-note-factory.md) | The note factory: a note issued whole in one transaction, owned by the factory for the Issuer | Accepted |
| [0092](0092-the-banks-deposit-acts.md) | The bank's acts on its deposit: debit, hold, pause and a move by order, on a Deposit page | Accepted |
| [0093](0093-sign-in-by-code.md) | Sign-in by a six-digit code sent by email, in place of one-time links | Accepted |
| [0094](0094-reconciliation-statement.md) | A reconciliation statement for every note, as at any day, now or a block | Accepted |
| [0095](0095-term-sheet-as-data.md) | The term sheet as data: a typed record, the input to issuance, its hash on the note | Accepted |
| [0096](0096-order-of-lifecycle-events.md) | The order of lifecycle events, written from the contracts and walked by a test | Accepted |
| [0097](0097-overview-for-0.2.0.md) | The overview rewritten for 0.2.0, and its PDF generated from it | Accepted |
| [0098](0098-ethereum-sepolia-and-the-bank-vm.md) | Ethereum Sepolia under Amsterdam, and the site as a container for the bank's VM | Accepted |
| [0099](0099-code-mail-links-to-the-code-page.md) | The code mail links to the page that takes the code | Accepted |
| [0100](0100-deleting-a-registration-and-the-wallet-message.md) | An admin may delete a registration; the wallet message names its site and expires on every route | Accepted |
| [0101](0101-full-suite-at-release-tags.md) | The full local suite runs at release tags; a change runs the tests that cover it | Accepted |
| [0102](0102-the-site-on-a-phone.md) | The site on a phone | Accepted |
| [0103](0103-waiting-for-ethereum-sepolia.md) | Waiting long enough for Ethereum Sepolia, and an issuance safe to run again | Accepted |
| [0104](0104-an-existing-identity-must-be-an-identity.md) | An identity brought to the site must be an ONCHAINID identity | Accepted |
| [0105](0105-an-issuance-that-cannot-hang.md) | An issuance that cannot hang, and can be stopped | Accepted |
| [0106](0106-addresses-shortened-and-linked.md) | Addresses shown short, and linked to the explorer | Accepted |
