# Structured note PoC

A proof of concept for native issuance of a structured note on a public test network, with the
Agent acting as issuing and paying agent, registrar and transfer agent.

- **What is being built and why:** `docs/solution-overview.html`, the signed-off phase 0a
  deliverable. The gated site in `site/` serves it.
- **Where things stand, decisions taken, hazards and open items:** `HANDOFF.md`. Read it
  before changing anything.
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

The venue is still exercised against two fixtures in `test/fixtures/`, a restricted asset with
the ERC-7943 interface and an open cash leg, until Wave 5 pairs the pool with the tokenized
deposit. Neither is an instrument and neither is in audit scope.

## Running it locally

You need Foundry and Node 20 or later.

```bash
git submodule update --init --recursive   # nothing compiles without them
./ops/reset.sh                            # fresh local chain, whole stack deployed
forge test --fork-url http://127.0.0.1:8545 -vv
./ops/build.sh                            # both units, with the EIP-170 check
```

The deploy sequence and why it is ordered as it is are in `ops/README.md`. With Claude Code,
`/demo` does all of the above.

## What the venue tests show

Each test states a control and shows a transaction succeeding or failing for the right reason.

| Control | Test |
|---|---|
| An eligible investor trades | `test_eligibleInvestor_canSwap` |
| Providing liquidity needs the venue's approval; the same plan succeeds for an approved investor | `test_swapOnlyInvestor_cannotProvideLiquidity` |
| An ineligible wallet cannot reach the asset by any route | `test_ineligibleWallet_cannotSwap` |
| Revoking eligibility on the asset stops trading at once, with no venue action | `test_revokedEligibility_haltsTrading` |
| A freeze by the Agent stops the wallet trading | `test_agentFreeze_haltsTrading` |
| Pausing the asset halts the whole market | `test_assetPause_haltsWholeMarket` |
| A token that does not answer the interface is denied, not trusted | `test_checkerFailsClosedOnNonConformingToken` |
| The Custodian trades for a client that never holds a key | `test_custodianTradesForEligibleClient` |
| Only the Custodian can operate a client account | `test_onlyCustodianCanOperateClientAccount` |
| Freezing one client leaves its siblings trading | `test_freezingOneClientDoesNotAffectOthers` |
| A forced transfer takes from one client only, and never delivers to an ineligible account | `test_forcedTransferFromSingleClient`, `test_forcedTransferRefusesIneligibleRecipient` |

## What the instruments tests show

`cd instruments && forge test --force` runs 86. Spike 2's conformance suite runs against both the note
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

## Contract size

At the default profile the permissioned position manager is 31,983 bytes, over the 24,576-byte
limit. `foundry.toml` compiles it and its base at 500 optimizer runs through per-path
restrictions, which gives 23,195 bytes. The core pool library does not compile at 500 runs, so
**no file may import both the position manager and the pool manager**; the deploy script
deploys both from their artifacts (`script/artifacts/`). Run `forge clean` after changing the
restrictions: an incremental build reports sizes from a mixed cache. The local node enforces
the standard limit. Detail in `docs/spikes/01-contract-size.md`.
