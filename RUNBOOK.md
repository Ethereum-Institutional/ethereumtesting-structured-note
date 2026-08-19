# Demo runbook

Two ways to run it:

- **Laptop** — most reliable, no internet needed. Use this for the live session.
- **Browser** — <https://apac-rwa-console.vercel.app>, backed by a hosted chain. Use this to
  share a link.

---

## Browser version

Two ways to back the hosted console with a chain.

### Fastest — tunnel from this laptop (no accounts, no logins)

```bash
cd ~/Desktop/apac-rwa-demo
./ops/serve-local.sh
```

About a minute. Starts the chain from the baked snapshot, opens a Cloudflare quick tunnel to
it, points Vercel at that tunnel and redeploys. <https://apac-rwa-console.vercel.app> then
shows live data from your machine, viewable on any device.

Caveats: the chain and tunnel both run here, so **this laptop must stay awake**, and the
tunnel URL changes every time — re-run the script if it drops.

### Laptop-independent — chain on Fly.io

```bash
flyctl auth login          # opens a browser
cd ~/Desktop/apac-rwa-demo
./ops/deploy-chain.sh      # ~5 min: publishes the chain, points Vercel at it
```

That script bakes a snapshot of the fully-deployed chain, ships it to Fly.io in Singapore,
verifies the RPC answers and the state restored, then sets `RPC_URL`/`CHAIN_ID` on Vercel and
redeploys the console. Safe to re-run.

**Reset the hosted demo** between meetings:

```bash
flyctl apps restart apac-rwa-chain
```

A restart reloads the baked snapshot, so everything returns to its opening state in about ten
seconds.

**Re-bake the snapshot** after changing any contract:

```bash
./ops/bake-state.sh && ./ops/deploy-chain.sh
```

**Caveats for the hosted version.** The chain is in-memory, so a Fly machine restart discards
anything done since the last deploy — usually a feature, occasionally a surprise. The RPC is
public and unauthenticated; it is a throwaway chain holding valueless test assets, and it must
never point at anything real. And the console URL lets anyone who has it freeze, pause and
trade, so treat the link as semi-private.

---

## Laptop version

Everything runs locally. No internet needed once dependencies are installed.

---

## Before the meeting (5 min, once)

Two terminals, both in `~/Desktop/apac-rwa-demo`.

**Terminal 1 — chain + contracts**

```bash
cd ~/Desktop/apac-rwa-demo
./ops/reset.sh
```

Takes about 60 seconds. You want the last line to read `Ready.` Prints 8 steps; if any
step fails it stops there and tells you which.

**Terminal 2 — dashboard**

```bash
cd ~/Desktop/apac-rwa-demo/dashboard
npm run dev
```

Open **http://localhost:3010**

**Optional sanity check** (Terminal 1, proves the compliance gates actually bind):

```bash
forge test --fork-url http://127.0.0.1:8545
```

Expect `13 tests passed`. Run this before you walk into the room.

---

## Leave it running

Anvil mines a block every second, so nothing goes stale and nothing times out. You can
leave both terminals up all day between meetings.

---

## Two pages

| Page | Job |
|---|---|
| `/build` | How it was built, step by step, with proof read live from the chain. Your walkthrough of the *process*. |
| `/` | The live console. Your demo of the *system*. |

Open `/build` first if the audience is technical or wants to know they could do it themselves;
go straight to `/` if they want to see it work.

## Everything is in the browser

Nothing in the demo needs a terminal any more. The console can:

- trade as any holder, direct or custodied
- freeze and unfreeze a wallet
- **partially freeze** part of a balance while the rest keeps trading
- **force-transfer** between holders (the recovery path)
- **complete KYC for a pending client, live** — mints their identity, has the trusted issuer
  attest it, registers them, allocates a holding
- **bind a concentration limit** at runtime via a compliance module
- pause the asset, disable venue trading, toggle the jurisdiction overlay
- **reset the whole demo** to a baseline

### About the reset button

First press on a fresh chain reads **Arm baseline** — it captures the current state. After
that it reads **Reset demo** and returns the chain to that point: balances, freezes, pauses
and the pool price all restored.

The baseline is an Anvil snapshot, and Anvil consumes a snapshot when it reverts, so the
console re-arms automatically after every reset. Snapshots do not survive a chain restart, so
after restarting you will see **Arm baseline** again — press it once at the start of the day.

## The demo — five acts, about 15 minutes

### Act 1 · This is a real security token (2 min)

Point at the **Asset** panel.

> "This is an ERC-3643 permissioned token. Tokeny's T-REX — the standard that about
> \$28 billion of tokenized assets already run on. This isn't a mock; it's their audited
> code, with an on-chain identity registry, a trusted KYC provider issuing signed claims,
> and modular compliance rules."

Then point at **In the pool adapter: 100,000**.

> "Here's the part people don't expect. Uniswap's adapter physically holds the asset. So
> under the token's own rules it has to be a verified holder like anyone else — it has its
> own on-chain identity, its own KYC claim, and it's registered in Singapore. The trading
> venue got onboarded exactly like an investor. That's what makes this auditable."

### Act 2 · Custody, segregated (3 min)

Point at the **Custody** panel, then the **Holders of record** table.

> "One custodian, four client accounts. Each client holds in its own account with its own
> identity, its own jurisdiction, its own claims. The custodian holds the keys — the client
> never signs anything."

Two rows to call out:

- **Harbour Retail Nominee** — `swap` is green, `LP` is red.
  > "Same asset, same pool. But providing liquidity requires a professional-investor
  > attestation, and this one is retail. The issuer's rule, enforced at the venue."
- **Prospect Capital** — status reads *identity not verified*.
  > "Funded with two million dollars of settlement cash, approvals all in place, KYC not
  > finished. Remember that."

### Act 3 · It trades like anything else (3 min)

In the **Trade** panel: *Acting for* → **Sakura Asset Management**, Buy, `25000`, **Swap**.

Watch the green confirmation, and the price tick up in the **Market** panel.

> "Ordinary AMM execution. The custodian signed that transaction, but the compliance check
> ran against Sakura's identity, not the custodian's. That's the bit that makes segregated
> custody work with an issuer-controlled allowlist."

### Act 4 · The controls actually bind (5 min) — the important act

Do these in order. Each one is a live transaction, not a UI check.

**a) The unverified client.** *Acting for* → **Prospect Capital** → **Swap**.

Rejected, with the reason.

> "That's not the interface saying no. The transaction reverted on-chain, in the hook,
> before any value moved. There's no route into this asset for that wallet."

**b) Freeze one client.** In the holders table, click **freeze** on **Sakura Asset
Management**. Then try to trade as Sakura → rejected. Now trade as **Lion City Family
Office** → settles.

> "One client frozen by the transfer agent. Its sibling, under the same custodian, carries
> on trading. That's the question every custodian asks me — *what happens to my other
> clients when one gets sanctioned?* With an omnibus wallet, you freeze it and everybody
> stops. Here, only that client stops."

Unfreeze Sakura before moving on.

**b2) Optional, and a strong one: onboard Prospect Capital live.** In **Asset servicing**,
pick Prospect Capital, choose a jurisdiction, set an allocation, press **onboard**. Then trade
as them — it settles.

> "That was the full onboarding: an on-chain identity minted for them, KYC attested by the
> trusted issuer, registered in the issuer's registry, and a holding allocated. They went from
> unable to touch the asset to trading it, in one transaction sequence, and the venue was never
> involved."

Note they can now *swap* but still cannot *provide liquidity* — that needs the
professional-investor claim, which was not attested. Two independent permissions.

**c) Venue-level jurisdiction.** In **Controls**, switch **Venue jurisdiction overlay** to
enforcing, then click **Japan** off.

Trade as Sakura (Japan) → rejected. Trade as Lion City (Singapore) → settles.

> "That's the venue's own rule, layered on top of the issuer's compliance module. Two
> independent sets of controls. The issuer doesn't have to trust the venue's rules, and the
> venue doesn't have to trust the issuer's."

Turn Japan back on and the overlay off.

**d) The big red button.** **Asset paused** → paused. Try any trade.

> "Issuer-level pause. Whole market stops, every holder, every venue."

Unpause.

### Act 5 · The point (2 min)

> "Nothing I just did required the venue to cooperate. No allowlist upload, no support
> ticket, no waiting. The issuer changed one thing in their own registry and the market
> responded on the next block.
>
> That's the piece OpenZeppelin builds: the compliance layer between an issuer's identity
> system and a real trading venue. Uniswap ships the pool infrastructure but deliberately
> leaves that hook to the integrator — the only one in their repo is a test mock. This is
> that missing piece."

---

## Reset between meetings

Terminal 1:

```bash
./ops/reset.sh
```

Contract addresses are deterministic, so the dashboard picks up the fresh chain on the next
page load — **no need to restart it.** Just refresh the browser.

---

## If something goes wrong

| Symptom | Fix |
|---|---|
| Dashboard shows an error or blank panels | Chain isn't up. Run `./ops/reset.sh`, refresh. |
| `forge: command not found` | `export PATH="$HOME/.foundry/bin:$PATH"` |
| Port 3010 already taken | `lsof -nP -iTCP:3010 -sTCP:LISTEN` then kill the PID |
| A trade fails unexpectedly | Check the **Controls** panel — asset paused, trading disabled, or the jurisdiction overlay is still on from an earlier act |
| Everything looks wrong | `./ops/reset.sh` fixes all of it in 60 seconds |

**Nuclear option**, if the chain gets into a strange state:

```bash
pkill -f anvil
./ops/reset.sh
```

---

## Facts worth having straight

**Do not say OpenZeppelin Contracts supports ERC-3643.** It doesn't yet — the
[T-REX Network partnership](https://www.openzeppelin.com/news/openzeppelin-and-trex-network-partner-to-advance-institutional-compliance-infrastructure)
(July 2026) is co-development in progress. What we ship today for permissioned tokens is
**ERC-7943 (uRWA)** in community-contracts. This demo is honest: genuine Tokeny T-REX for
the asset, OpenZeppelin for the integration and custody layers.

**If asked what's ours:** `ERC3643AllowlistChecker` (the identity bridge),
`PermissionedComplianceHook` (the hook v4-periphery leaves to integrators), and
`CustodyAccount` (segregated client custody). Everything else is Tokeny's or Uniswap's.

**If asked whether it works on mainnet:** the compliance layer, yes. One caveat —
Uniswap's `PermissionedPositionManager` compiles to ~32KB here, over the 24,576-byte
contract size limit, so the local node runs with a raised limit. That has to be resolved
before a public deployment. Don't oversell this point; it's a build-config issue, not a
design one.

**If asked for a link:** it's laptop-local today. Making it shareable means hosting the
dashboard on Vercel and the chain on a small cloud box — about an hour of work. Ask first.
