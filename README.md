# Structured note PoC

A proof of concept for native issuance of a structured note on a public test network, with the
Agent acting as issuing and paying agent, registrar and transfer agent.

- **What is being built and why:** `docs/solution-overview.html`, the signed-off phase 0a
  deliverable. The gated site in `site/` serves it.
- **Where things stand, decisions taken, hazards and open items:** `HANDOFF.md`. Read it
  before changing anything.
- **Why each design decision went the way it did:** `docs/adr/`.
- **Spikes:** `docs/spikes/`, with their harnesses under `spikes/`.

Parties are referred to by capacity throughout. No client, counterparty or vendor is named in
this repository.

## Layout

The contracts build in two compilation units, because no single compiler configuration fits
both under EIP-170 (spike 1).

| Directory | Unit | Holds |
|---|---|---|
| `contracts/`, `script/`, `test/` | solc 0.8.26, IR pipeline | The venue: compliance hook, checker, router, custody accounts, and their deploy scripts and tests |
| `instruments/` | solc 0.8.34, legacy pipeline | The note and the tokenized deposit, on the debt standard pinned at its release candidate |
| `site/` | Next.js | The registration-gated site, and the chain library the operations console will use |
| `ops/` | | Local chain and deploy scripts |

The venue is the conversion pool, deployed by default: the euro payment token against the
tokenized deposit, gated by the deposit's own eligibility and by the pool's gate on the same
ONCHAINID identities (ADR 0090). The gate reads the pool's own ERC-3643 identity registry, which
requires the onboarding agent's pool-access claim, and admits a wallet whose country is one the
pool serves and whom supervision has not withdrawn. Locally the payment token is a stand-in in
`test/fixtures/`; on the test network it is the real deployment, named in the network file
(`ops/networks/`).

## Running it locally

You need Foundry and Node 20 or later.

```bash
git submodule update --init --recursive   # nothing compiles without them
./ops/reset.sh                            # fresh local chain, whole stack deployed
forge test --fork-url http://127.0.0.1:8545 -vv
./ops/build.sh                            # both units, with the EIP-170 check
./ops/dry-run-fork.sh                     # the whole stack against a fork of the test network
```

The dry run needs `ops/networks/base-sepolia.json`, which is not committed; copy the template
beside it and fill it from the private working documents.

The deploy sequence and why it is ordered as it is are in `ops/README.md`. With Claude Code,
`/demo` does all of the above.

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
| The onboarding agent revoking its pool-access claim stops the wallet at once | `test_claimRevocation_stopsTheWallet` |
| Ceasing to trust the onboarding agent's issuer for pool access closes the pool | `test_issuerNoLongerTrusted_closesThePool` |
| Supervisory withdrawal and restoration of pool access are Tier 1 | `test_tier1WithdrawalAndRestorationOfPoolAccess` |
| The bank revoking its deposit claim stops the pool at once (ADR 0004) | `test_depositClaimRevocation_stopsThePool` |
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

`cd instruments && forge test --force` runs 115. Spike 2's conformance suite runs against both the note
and the deposit: views that never revert under any gate failure, forced transfer only under its
own role and never to an ineligible account, the written reason carried whole, and an admin that
holds no role it was not granted. Against the registry: grants lapse at expiry, revocation is
immediate, a registrar cannot act on another's participant, and a check is one storage read.
Against the deployed wiring: decimals zero and two, one registry behind both gates, the note
refusing an account onboarded for the cash leg only, and a lapsed holder still redeemable.

Against the lifecycle: all 25 scenarios of spike 3's independent payoff model, reproduced to the
cent from signed determination through distribution and burn, closing at zero positions. Seven
deliberate errors in the payoff (an inclusive barrier, a strict coupon, a reversed tie-break and
so on) were each caught by that test. Also: a disagreeing or wrongly signed determination
refused, the Record Time inclusive, transfers stopped at a possible redemption until it is
determined, an event that closes only when every unit is paid, a held payment claimed after
re-onboarding, and DvP refusing an ineligible counterparty with nothing moved.

Against governance: Tier 1 only by the Agent's governance wallet, with its reason; Tier 2 refusing
one institution, four signatures in one firm, and two institutions with weak wallets; thresholds
checked again at execution; recovery needing every other institution and the longer delay, and
vetoed by a wallet that still works; the worked example of the wrong Record Time reversed and
restated; and the deployer holding nothing after the ceremony. Four deliberate errors in the
controller, and four in its venue acts, were each caught. `FOUNDRY_PROFILE=fork forge test --fork-url http://127.0.0.1:8545` (from `instruments/`) repeats Tier 1 and Tier 2 through
the real multi-signature wallets on the local stack.

## Contract size

At the default profile the permissioned position manager is 31,983 bytes, over the 24,576-byte
limit. `foundry.toml` compiles it and its base at 500 optimizer runs through per-path
restrictions, which gives 23,195 bytes. The core pool library does not compile at 500 runs, so
**no file may import both the position manager and the pool manager**; the deploy script
deploys both from their artifacts (`script/artifacts/`). Run `forge clean` after changing the
restrictions: an incremental build reports sizes from a mixed cache. The local node enforces
the standard limit. Detail in `docs/spikes/01-contract-size.md`.
