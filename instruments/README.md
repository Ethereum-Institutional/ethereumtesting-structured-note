# Instruments

The compilation unit for the note programme: the notes, their identities and lifecycle, the
governance controller, the note factory, and the tokenized deposit. Each note is an ERC-3643 token
through T-REX 5.0.0-beta2, with ONCHAINID 2.2.2-beta3 identities. Both are pinned in
`soldeer.lock`, and `forge soldeer install` fetches them; T-REX pins solc 0.8.30, so the unit
compiles with it. The venue (repository root) is a separate unit, on solc 0.8.26; the two meet only
over ABI.

T-REX's token, registries and compliance are used unmodified. Our contracts, with their deployed
sizes (from `forge build --sizes`):

| Contract | Is | Licence | Size (bytes) |
|---|---|---|---|
| `src/claims/ExpiringClaimIssuer.sol` | An institution's claim issuer, whose claims lapse: issue, lapse and record hash in the claim's data; revocable at once | GPL-3.0 | 13,210 |
| `src/claims/ClaimTopics.sol` | The deployment's claim topics: deposit-eligible, note-eligible, pool access, term sheet, series | MPL-2.0 | library |
| `src/compliance/RecordDateModule.sol` | A note's compliance module, one clone per note: balances at any past instant (E1), the transfer stop at a possible redemption (E4), refused for forced transfers too | GPL-3.0 | 3,646 |
| `src/compliance/ProgrammeSanctions.sol` | The programme's compliance module, on every note: a designated account cannot send or receive any note | GPL-3.0 | 1,608 |
| `src/FixedImplementationAuthority.sol` | The implementations behind every T-REX proxy, fixed for good, in place of T-REX's switchable authority | MPL-2.0 | 406 |
| `src/DepositToken.sol` | The cash leg, like a bank's allowlisted deposit token: eligible by the bank's own identity registry or the allowlist; sender, receiver and spender checked; ERC-7943 freezing and forced transfer; roles administered by the controller | MPL-2.0 | 6,573 |
| `src/interfaces/IDepositGateway.sol`, `src/DepositGateway.sol` | What a deposit service must expose to settle on a public network: credit and debit, each against a single-use booking reference | MPL-2.0 | 1,877 |
| `src/DeterminationAgent.sol` | A note's terms and calendar, fixed at issuance, one clone per note; accepts a signed determination only when its own computation agrees, and a Tier 2 correction of the latest | MPL-2.0 | 12,905 |
| `src/PayingAgent.sol` | Coupons and redemptions to holders of record, one clone per note, reconciled on-chain; amounts the deposit cannot credit are held and claimable; coupon reversal and restatement for the controller. The note's agent for burning and pausing | MPL-2.0 | 9,642 |
| `src/LockedSettlement.sol` | Delivery versus payment by locked offer, one clone per note. The note's agent for partial freezing | MPL-2.0 | 6,315 |
| `src/factory/NoteFactory.sol` | Owned by the Issuer's 2-of-3 wallet. Issues a note whole in one transaction, or several in one call: series number and optional ISIN, clones, the T-REX suite, the deposit allowlisting, and the hand-over to the controller | GPL-3.0 | 13,445 |
| `src/factory/ProgrammeTREXFactory.sol` | T-REX's factory, with retirement of a redeemed note's registry from the shared storage and release to a successor | GPL-3.0 | 22,951 |
| `src/factory/AgentPowers.sol` | Each agent's powers on a note: every power off, then only its own on | MPL-2.0 | library |
| `src/GovernanceController.sol` | One controller for every note. Every privileged power, in two tiers, through typed acts naming the note; the programme's register of roles (`IProgrammeRoles`); owner of every note's suite | MPL-2.0 | 23,602 |
| `src/VenueActs.sol`, `src/CorrectionActs.sol` | The controller's venue acts and its correction of a determination, as libraries called by delegatecall, to keep it under the size limit | MPL-2.0 | 1,652; 2,704 |

The MPL-2.0 contracts reach T-REX only through `src/interfaces/INote.sol`.

The scripts:
- `script/Scaffolding.sol` builds the shared scaffolding (`DeployInstruments.s.sol`);
- `script/Onboarding.sol` onboards a client by role;
- `script/Programme.sol` deploys the programme: the sanctions module, the controller and the note
  factory (`DeployProgramme.s.sol`), and holds the ceremony (`Ceremony.s.sol`);
- `script/Issuance.sol` issues a note through the factory as the Issuer's wallet (`IssueNote.s.sol`),
  with `script/WalletExec.sol` signing for a multi-signature wallet.

Each is used by its script and by the tests (`test/Stack.sol`), so the tests exercise exactly what
is deployed. After the ceremony the deployer holds nothing: every note belongs to the controller
from issuance, and the factory to the Issuer's wallet.

```bash
forge build --sizes
forge test --force  # 104, including all 25 payoff scenarios end to end
FOUNDRY_PROFILE=fork forge test --fork-url http://127.0.0.1:8545   # governance through the real wallets
python3 test/vectors/flatten.py   # after regenerating spikes/payoff/vectors.json
```

Use `--force` after changing a contract. Forge's incremental build can leave a test running
against stale creation code for a contract it deploys, so a changed contract appears to pass.

## Contract surface

No surface is frozen yet. The final freeze follows the Issuer's and the Calculation Agent's
confirmation of the payoff positions, and token naming. From then on, a change to any file in the
surface is listed, with its reason, in the diff put to review.
