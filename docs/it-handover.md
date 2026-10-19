# IT hand-over: running the structured-note PoC at the bank

For the bank's IT team. It covers deploying the bank's own complete stack on Ethereum Sepolia, at
release 0.3.0, and running the site on the bank's virtual machine. The solution overview
(`docs/solution-overview.html`, or its PDF) explains what the system does. This guide covers only
how to stand it up and keep it running.

The bank's deployment is its own. It shares no keys, contracts or records with our public
demonstration on the same network, and neither depends on the other.

---

## 1. What runs where

| Part | Where | Notes |
|---|---|---|
| Contracts: the governance controller, the note factory and every note it issues, the tokenized deposit, identities and claims, the sanctions module, the conversion pool, the multi-signature wallets | Ethereum Sepolia (chain 11155111), public | Deployed once from a workstation (section 3). Public and permanent |
| The site: five portals behind one sign-in | A container on the bank's VM | `ops/vm/Dockerfile` |
| The site's database: registrations, sessions, sign-in codes, clients, term sheets, jobs, the event index, key leases, audit | A Postgres container beside it | `ops/vm/compose.yaml`, on a named volume |
| Sign-in mail: six-digit codes | Resend, over HTTPS | The bank provides an API key and a sending domain |
| Chain access | An Ethereum Sepolia RPC endpoint over HTTPS, such as Alchemy | Alchemy is preferred: the Ledger's log queries span the whole range |

**Network.**
- **Outbound:** HTTPS only, to the RPC host and to `api.resend.com`.
- **Inbound:** the bank's TLS reverse proxy forwards to `127.0.0.1:3020`. Serve the site over HTTPS only: it sets secure cookies and HSTS.
- **Fonts:** browsers load them from Google Fonts. Where that is blocked, the pages fall back to system fonts and still work.

**The VM.** Linux with Docker Engine 24 or later and the compose plugin. Two vCPUs, 4 GB of memory
and 20 GB of disk are ample.

## 2. Keys

The site signs transactions itself, in each capacity a demonstration needs: the Issuer, the Agent,
the Calculation Agent, the onboarding agent, the bank as Deposit Agent, the custodians, and two
owners of each multi-signature wallet (the Agent's, the Issuer's, the co-signing institution's and
the servicing wallet). These are **test-network keys**. They control nothing of
value, but they control the deployment: whoever holds them can act as any party.

- Generate them once, with `./ops/new-network-keys.sh <name>`. It writes `ops/keys.<name>.env`, which only its owner can read and git ignores, holding one 24-word mnemonic and each capacity's key. It prints addresses, never keys.
- Keep that file as the bank keeps any credential: in its secret store, with a copy offline. It is the only way to recover the deployment's control.
- **Never** use the keys in `ops/keys.env`. They are the local test node's published keys, and on the public network others hold them. The deploy refuses them.

## 3. Deploying the contracts (once)

From a workstation, not the VM, with the repository checked out at the release tag. You need:
- Foundry 1.8 or later;
- Node 24 or later (then `npm ci` in `site/`);
- `jq` and Python 3.

`./ops/sepolia.sh` keeps each command short. It reads `ops/networks/ethereum-sepolia.json` and
`ops/keys.ethereum-sepolia.env`, so use those names.

1. **The network file.** Copy `ops/networks/ethereum-sepolia.example.json` to `ops/networks/ethereum-sepolia.json` (git ignores it). In the copy:
   - set `rpcUrl`;
   - set the names under `names`: the note's and the deposit's names and symbols, as agreed in the naming sign-off;
   - set `TERM_SHEET_BASE` to the site's own origin, such as `https://notes.bank.example`. The note's term-sheet claim points there.

   The canonical contracts in the file were checked on Ethereum Sepolia:
   - the Uniswap v4 pool manager;
   - WETH;
   - Circle's EURC.
2. **Keys.** Run `./ops/new-network-keys.sh ethereum-sepolia`.
3. **Funding.** Fund each address it prints with Sepolia ETH, and the Deposit Agent's address with some EURC from Circle's faucet, to seed the conversion pool. The deployment uses about 650M gas, most of it the Issuer's.

   Ethereum Sepolia runs the Amsterdam upgrade, which prices contract creation about five times
   higher than before. At a fee of about 0.001 gwei the whole deployment costs under 0.001 ETH. The
   script checks every balance against three times the current fee, with a floor of 0.01 ETH, and
   lists any address that is short. To check funding without deploying:

   ```
   ./ops/sepolia.sh check
   ```
4. **A rehearsal, if wanted.** It deploys the whole sequence against a local fork of Sepolia and publishes nothing:

   ```
   NETWORK_FILE=ops/networks/ethereum-sepolia.json ./ops/dry-run-fork.sh
   ```
5. **Etherscan.** To have the deploy verify every contract, store an Etherscan API key in the key
   file first. On macOS the script asks for the value in a hidden dialog, so it never appears on
   screen; elsewhere, add an `export ETHERSCAN_API_KEY=` line to the key file with an editor:

   ```
   ./ops/store-secret.sh ETHERSCAN_API_KEY ops/keys.ethereum-sepolia.env
   ```
6. **Deploy:**

   ```
   ./ops/sepolia.sh deploy
   ```

   It sends a few hundred transactions, one at a time, each waiting for the last, so it takes some
   minutes. The order is fixed: the base, the scaffolding, the conversion pool, custody, the
   programme (the institutions' wallets, the sanctions module, the governance controller and the
   note factory), the first note's term sheet, the first note, issued by the Issuer's wallet, and
   the ceremony, which leaves the deployer holding nothing. It writes
   `ops/addresses.ethereum-sepolia.json`, the manifest the site reads. The manifest holds addresses
   and the term sheet, nothing secret. Keep it with the release.
7. **Verification.** The deploy verifies every contract on Etherscan by itself, including those
   created inside transactions, each note's minimal clones and the controller's linked libraries,
   and skips any already verified. T-REX's deployment stubs have no source and are listed as such.
   To run it again, or after adding the key:

   ```
   ./ops/sepolia.sh verify
   ```

Further notes are issued from the site, by the Issuer's wallet, and need no new deployment.

## 4. Running the site on the VM

1. **The image.** Build it from the repository root at the release tag, or load the image we
   provide. Use the tag `ops/vm/compose.yaml` names:

   ```
   docker build -f ops/vm/Dockerfile -t structured-note-site:0.3.1 .
   ```

   The image holds no keys, addresses or settings; all of them arrive at run time.
2. **The settings.** On the workstation that holds the keys, set the site's own values, one line
   each, then write the files:

   ```
   export SITE_URL=https://notes.bank.example
   export MAIL_FROM='Structured notes <notes@bank.example>'
   export RESEND_API_KEY=<key>
   export OPERATOR_EMAILS=<staff with every portal>
   N=ethereum-sepolia
   ./ops/vm/vm-env.sh ops/addresses.$N.json ops/networks/$N.json ops/keys.$N.env
   ```

   It writes three files into `ops/vm/`. Only their owner can read them, and git ignores them:
   - `site.env`: the RPC, the signing keys, and the mail and staff settings;
   - `manifest.json`;
   - `.env`: a generated database password.

   It prints the names it wrote and never the values. Any setting not given is written empty, to
   be filled in on the VM. The desk's settings in the table below (`FOUR_EYES`, the duty lists,
   `CRON_SECRET`) are added to `site.env` by hand. Copy the three files to the VM over the bank's
   usual secure channel, together with `ops/vm/compose.yaml`.
3. **Start it:**

   ```
   docker compose -f compose.yaml up -d
   ```

   The site creates its tables on first use. Check the server with
   `curl -I http://127.0.0.1:3020/` on the VM, and the whole path through the proxy at the public
   address.
4. **The scheduled run.** Issuance and payment runs are background jobs in the database. They carry
   on after the request that started them and on every staff page load, so nothing more is needed.
   As a backstop, set `CRON_SECRET` and have the VM's scheduler call the site's job route once a
   minute or once a day, with the secret as a bearer token:

   ```
   curl -H "Authorization: Bearer $CRON_SECRET" localhost:3020/api/jobs/tick
   ```

### Settings

| Setting | Required | What it is |
|---|---|---|
| `RPC_URL` | Yes | The Ethereum Sepolia RPC the site reads and sends through |
| `LEDGER_RPC_URL` | With Alchemy | Alchemy's URL for the Ledger's log queries; written when the key file holds `ALCHEMY_API_KEY` |
| `SIGNER_KEYS` | Yes | The capacities' keys, as JSON |
| `MANIFEST_PATH` | Yes | Set by compose to the mounted `manifest.json` |
| `POSTGRES_URL` | Yes | Set by compose, from `DB_PASSWORD` in `.env` |
| `SITE_URL` | Yes | The public origin; links in mail and the term sheet's address use it |
| `RESEND_API_KEY`, `MAIL_FROM` | Yes, to sign in | Without them the site starts, but it refuses to send a code. It never shows one on screen instead |
| `OPERATOR_EMAILS` | Yes | Staff with every portal and both duties. `BANK_EMAILS`, `ONBOARDING_EMAILS`, `AGENT_EMAILS` and `CUSTODIAN_EMAILS` grant one portal each |
| `CALCULATION_EMAILS`, `PAYMENTS_EMAILS` | No | The Agent's staff with the Calculation Agent duty and the payments duty. Unset, everyone at the Agent's desk holds the duty |
| `FOUR_EYES` | No | `auto` (the default): an automatic second approver approves each determination and payment at once, for a demonstration. `strict`: a second person with the same duty must approve. Set `strict` for a real desk |
| `CRON_SECRET` | No | The bearer token the job route requires (section 4, step 4). Without it the route refuses every call |
| `AUTO_APPROVE_DOMAINS` | No | Email domains whose registrations are approved once the address is confirmed |
| `TOP_UP_ETH`, `FEE_BUFFER_ETH` | No | How much a key top-up sends (default 0.003), and the balance under which a key counts as low (0.001) |
| `INDEX_SETTLE_BLOCKS` | No | For tests only. On a public network the event index leaves the three newest blocks to settle |

## 5. Running it

**Logs.** Use `docker compose logs -f site`. Errors are logged; keys and codes never are.

**Fees.** Every transaction the site sends is paid from the acting capacity's key. The Agent
portal's Keys page (`/agent/keys`) shows each balance and how many transactions it pays for, and tops up a low key
from the best-funded one. Fund the Issuer's key from outside when they all run low.

**Jobs.** The Agent's portal shows each issuance and payment run with its progress. A failed step
is retried, waiting longer each time; after eight tries the job is marked failed with its reason.
Staff can stop a job; whatever already reached the chain stays there. The Book lists what is due
across every note, what awaits a second approver, and any job running or failed.

**Backups.** Take a nightly `docker compose exec db pg_dump -U site site`. The database holds
registrations, sessions, clients, the term sheets of notes issued from the site, jobs, the audit
log and the event index. The chain holds everything else: positions, identities and claims,
distributions. Losing the database loses the sign-ins and the client records, not the notes; the
event index is read again from the chain.

**Upgrades.** Build or load the new image, then run `docker compose up -d`. The database volume is
kept. A release that needs a new contract deployment says so in its notes.

**Rotating the keys.** The programme's roles (the servicing wallet, the Calculation Agent and the
funder) and each institution's wallet can be replaced by Tier 2 acts. The site's own keys cannot be
swapped under a deployment. To start fresh:
1. generate new keys;
2. deploy again;
3. rerun `vm-env.sh`;
4. restart the site.

The old deployment stays on the chain, untouched.

## 6. When something goes wrong

| Symptom | Likely cause |
|---|---|
| "Mail is not configured" at sign-in | `RESEND_API_KEY` or `MAIL_FROM` is empty, or the VM cannot reach `api.resend.com` |
| The site will not start: "No database configured" | `POSTGRES_URL` is missing: start the site through compose, not alone |
| The site will not start: a manifest error naming a key | The manifest is from another release or is incomplete: use the one this release's deployment wrote |
| An act fails with "insufficient funds" | That capacity's key is out of ETH: top it up from the Keys page |
| A job waits and does not move | No request has carried it on since: open any staff page, or check the scheduled run and `CRON_SECRET` |
| A determination or payment waits for approval | `FOUR_EYES=strict`: a second person with the same duty must approve it |
| Pages load but nothing on the chain shows | `RPC_URL` points at another chain, or the RPC refuses the VM |
| `./ops/sepolia.sh deploy` stops with a list of addresses | Those addresses need funding. Fund them and run it again: it has sent nothing yet |
| `./ops/sepolia.sh deploy` stops part way | Read the error. A step already sent is on the chain. Ask us before running again, since some steps are not repeatable |

## 7. Where to look further

| Document | What it covers |
|---|---|
| `README.md` | The repository's layout, its commands and its test suites |
| `docs/solution-overview.html` | What the system does and why |
| `docs/lifecycle-sequence.md` | The order of events the contracts enforce |
| `docs/adr/` | One current record per design topic, with its reasons |
| `docs/ai-build-brief.md` | The requirements and design, written for the bank's own AI-led build |
