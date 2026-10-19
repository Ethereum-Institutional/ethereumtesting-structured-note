# Structured note PoC

A proof of concept for native issuance of structured notes on a public test network, with the
Agent acting as issuing and paying agent, registrar and transfer agent for a programme of notes.
Release 0.3.0: each note an ERC-3643 token, issued whole by a note factory the Issuer's 2-of-3
wallet owns and governed from its first block by one governance controller for every note;
onboarding by role on ONCHAINID identities; the bank's tokenized deposit; the conversion pool; and
a desk that runs the book, with background jobs, an index of the programme's events, and four eyes
on determinations and payments. It is deployed to Ethereum Sepolia, every contract verified on
Etherscan, and the site at https://structurednote-project.ethereumtesting.com points at it.

- **What is being built and why:** `docs/solution-overview.html`, and its PDF,
  `docs/solution-overview.pdf`, generated from it. The gated site in `site/` serves the overview.
- **The order of a note's life,** step by step, as the contracts enforce it:
  `docs/lifecycle-sequence.md`.
- **Why each design decision went the way it did:** `docs/adr/`, one current record per topic,
  indexed in its README.
- **The release plans:** `docs/plan/0.3.0.md`, and 0.2.0's before it.
- **Where things stand, hazards and open items:** `HANDOFF.md`.
- **For the bank's IT team:** `docs/it-handover.md` and `docs/ai-build-brief.md`.
- **Spikes:** `docs/spikes/`, with their harnesses under `spikes/`.

Parties are referred to by capacity throughout. No client, counterparty or vendor is named in
this repository.

## Layout

The contracts build in two compilation units, because no single compiler configuration fits
both: the venue's pool library needs the IR pipeline at high optimizer runs, and T-REX pins its own
compiler.

| Directory | Unit | Holds |
|---|---|---|
| `instruments/` | solc 0.8.30, T-REX 5.0.0-beta2 and ONCHAINID 2.2 by Soldeer | The notes (ERC-3643), the record-date and sanctions modules, the claim issuers, the tokenized deposit and its gateway, the Determination Agent, the Paying Agent, locked settlement, the note factory and the governance controller, with their deploy scripts and tests |
| `contracts/`, `script/`, `test/` | solc 0.8.26, IR pipeline | The venue (hook, checker, router, pool gate) and custody accounts, with their deploy scripts and tests |
| `site/` | Next.js | The site: five portals behind sign-in by emailed code, the Book, background jobs, the event index, the Ledger, reconciliation, and the chain library |
| `ops/` | | The local chain, the deploy sequence, snapshots and keys; `ops/sepolia.sh` for the Ethereum Sepolia deployment; `ops/vm/`, the site's container bundle for the bank's virtual machine |
| `docs/` | | The overview and its PDF, the lifecycle sequence, the IT hand-over guide, the AI build brief, the decision records, the plans and spikes |

T-REX and ONCHAINID are GPL-3.0; only the files that compile them in carry that licence.

The venue is the conversion pool, deployed by default: the euro payment token against the
tokenized deposit, gated by the deposit's own eligibility and by the pool's gate on the same
ONCHAINID identities. The gate reads the pool's own ERC-3643 identity registry, which
requires the bank's pool-access claim, and admits a wallet whose country is one the pool serves and
whom supervision has not withdrawn. Locally the payment token is a stand-in in `test/fixtures/`; on
the test network it is EURC, named in the network file (`ops/networks/`).

## Running it locally

You need Foundry, Node 24 or later (the scripts and tests are TypeScript, run directly), and `jq`.

```bash
git submodule update --init --recursive   # the venue's dependencies
(cd instruments && forge soldeer install) # T-REX, ONCHAINID, OpenZeppelin
(cd site && npm install)
./ops/reset.sh                            # fresh local chain, whole stack deployed, or a snapshot restored
cd site && npm run test:local             # unit, integration and browser tests, on the local chain only
```

`ops/reset.sh` deploys afresh only when what the deployment is made from has changed, and otherwise
restores a snapshot in seconds; `FRESH=1` forces a deployment. The deploy sequence is
`ops/deploy-stack.sh`, and its order cannot change: the base (parties and payment token), the
scaffolding (`DeployInstruments`), the venue (scripts 01 to 03, unless `POOL=0`), custody (04), the
programme (`DeployProgramme`), the term sheet, the first note (`IssueNote`), and the ceremony.

On Ethereum Sepolia, `./ops/sepolia.sh check` checks every key's balance and sends nothing;
`deploy` deploys the whole stack and verifies it on Etherscan; `verify` retries verification; and
`site-env` points the site's Vercel project at the deployment.

| Suite | Command | Runs |
|---|---|---|
| Instruments | `cd instruments && forge test` | 104, including the lifecycle walked in order and the 25 payoff scenarios to the cent |
| Venue | `forge test --fork-url http://127.0.0.1:8545` | 31, against the deployed stack after the ceremony |
| Site, unit | `cd site && npm test` | 47 |
| Site, integration | `cd site && npm run test:admission` | 45: onboarding, notes, governance, jobs, the deposit and the deployment, through a proxy that answers a block behind, as a load-balanced public RPC does |
| Site, browser | `cd site && npm run test:browser` | 21 specs, every portal clicked through in Chromium, the Book and issuing from a term sheet included, and every page at a phone's width |

The full suite runs at release tags; a change runs the tests that cover it. Nothing is tested on a
public network. The overview's PDF is regenerated from the HTML with `cd site && node scripts/overview-pdf.ts`.

## What the venue tests show

Each test states a control and shows a transaction succeeding or failing for the right reason;
every refusal has a positive control. They run against the deployed stack, after the ceremony.

| Control | Test |
|---|---|
| An admitted investor converts the payment token into the deposit near par (S-27) | `test_admittedInvestor_convertsIntoTheDeposit` |
| An admitted investor converts the deposit back | `test_admittedInvestor_convertsOutOfTheDeposit` |
| A wallet the deposit accepts but with no pool-access claim is refused by the pool; admitted, it converts (S-28) | `test_noPoolClaim_refusedByThePoolThoughTheDepositAccepts` |
| A wallet onboarded nowhere is refused despite funds and approvals | `test_notOnboarded_refused` |
| Only the Deposit Agent provides liquidity; the same plan is refused for an investor | `test_onlyTheDepositAgentProvidesLiquidity` |
| A liquidity position cannot be transferred (S-29) | `test_liquidityPositionIsNotTransferable` |
| The bank revoking its pool-access claim stops the wallet at once | `test_claimRevocation_stopsTheWallet` |
| Ceasing to trust the bank's issuer for pool access, a Tier 2 act, closes the pool | `test_issuerNoLongerTrusted_closesThePool` |
| Supervisory withdrawal and restoration of pool access are Tier 1 | `test_tier1WithdrawalAndRestorationOfPoolAccess` |
| The bank revoking its deposit claim stops the pool at once | `test_depositClaimRevocation_stopsThePool` |
| A deposit freeze stops the wallet; a deposit pause halts the pool | `test_depositFreeze_stopsTheWallet`, `test_depositPause_haltsThePool` |
| The servicing wallet switches swapping off and on through the controller | `test_servicingWalletSwitchesSwapping` |
| A pool-access claim lapses without any transaction | `test_poolClaimLapses` |
| The pool serves the EEA, Switzerland and the United Kingdom | `test_jurisdictionsServed` |
| A gate or token that cannot answer denies rather than reverting | `test_unanswerableGate_deniesEveryone`, `test_checkerFailsClosedOnNonConformingToken` |
| The venue answers to the controller alone | `test_theVenueIsGoverned` |
| The Custodian converts for an admitted client that never holds a key; only the Custodian operates it | `test_custodianConvertsForAdmittedClient`, `test_onlyCustodianCanOperateClientAccount` |
| A client account not admitted, or not onboarded, is refused | `test_notAdmittedClient_refusedByThePool`, `test_notOnboardedClient_refused` |
| Freezing or withdrawing one client leaves its sibling converting | `test_freezingOneClientDoesNotAffectOthers`, `test_withdrawingOneClientsAccessDoesNotAffectOthers` |

`test/IdentityPoolGate.t.sol` tests the gate alone, against a stand-in for the pool's identity
registry, with no chain: verified and served, not verified, a jurisdiction not served, withdrawal
and restoration by the supervisor alone with a reason, a registry that cannot answer denying, and
the configuration checked. The venue tests run against a fork of the test network too
(`ops/dry-run-fork.sh`).

## What the instruments tests show

`cd instruments && forge test` runs 104:
- **The lifecycle, in order.** `Sequence.t.sol` walks one note through every step of
  `docs/lifecycle-sequence.md`, trying each too early or out of turn first.
- **The payoff.** All 25 scenarios of spike 3's independent payoff model, reproduced to the cent from signed determination through distribution and burn, closing at zero positions.
- **Identities and claims.** Claims lapse and are revoked at once by their issuer, an institution cannot vouch without consent, an untrusted issuer does not verify, and the note refuses an account onboarded for the cash leg only.
- **The deposit.** Eligibility by the bank's registry or its allowlist, the spender checked, holds, pause, a forced transfer, and the bank's move by order with its reason.
- **The note factory.** Only the Issuer's wallet issues; a whole note in one transaction, or several in one call; each note its own clones, series identity and any further claims its series requires; every note recorded, governed from issuance, and none issued around the factory; retirement and release of the identity storage the controller's alone.
- **Governance.** One controller for every note. Tier 1 only by the Agent's governance wallet, with its reason, a freeze or recovery across notes, and sanctions designation; Tier 2 refusing one institution, or weak wallets, expiring past its window; recovery needing every other institution and the longer delay; each programme role rotated for every note in one act; a determination corrected before and after payment, and refused while its coupon is being paid; the worked example of the wrong Record Time reversed and restated; and the deployer and the Issuer holding nothing after the ceremony.

## Contract size

At the default profile the permissioned position manager is 31,983 bytes, over the 24,576-byte
limit. `foundry.toml` compiles it and its base at 500 optimizer runs through per-path
restrictions, which gives 23,195 bytes. The core pool library does not compile at 500 runs, so
**no file may import both the position manager and the pool manager**; the deploy script
deploys both from their artifacts (`script/artifacts/`). Run `forge clean` after changing the
restrictions: an incremental build reports sizes from a mixed cache. The local node enforces
the standard limit. Detail in `docs/spikes/01-contract-size.md`.
