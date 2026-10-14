# Instruments

The compilation unit for the note, its identities and lifecycle, and the tokenized deposit. From
0.2.0 the note is an ERC-3643 token through T-REX 5.0.0-beta2, with ONCHAINID 2.2.2-beta3
identities (ADRs 0085 to 0088). Both are pinned in `soldeer.lock`, and `forge soldeer install`
fetches them; T-REX pins solc 0.8.30, so the unit compiles with it. The venue (repository root)
is a separate unit, on solc 0.8.26; the two meet only over ABI.

T-REX's token, registries and compliance are used unmodified. Our contracts:

| Contract | Is | Licence | Size (bytes) |
|---|---|---|---|
| `src/claims/ExpiringClaimIssuer.sol` | An institution's claim issuer, whose claims lapse: issue, lapse and record hash in the claim's data; revocable at once | GPL-3.0 | 13,210 |
| `src/claims/ClaimTopics.sol` | The deployment's claim topics: deposit-eligible, note-eligible, term sheet | MPL-2.0 | |
| `src/compliance/RecordDateModule.sol` | The note's compliance module: balances at any past instant (E1), the transfer stop at a possible redemption (E4), refused for forced transfers too | GPL-3.0 | 3,599 |
| `src/FixedImplementationAuthority.sol` | The implementations behind every T-REX proxy, fixed for good, in place of T-REX's switchable authority (ADR 0088) | MPL-2.0 | 406 |
| `src/DepositToken.sol` | The cash leg, like a bank's allowlisted deposit token: eligible by the bank's own identity registry or the allowlist; sender, receiver and spender checked; ERC-7943 freezing and forced transfer | MPL-2.0 | 5,611 |
| `src/interfaces/IDepositGateway.sol`, `src/DepositGateway.sol` | What a deposit service must expose to settle on a public network: credit and debit, each against a single-use booking reference | MPL-2.0 | 1,877 |
| `src/DeterminationAgent.sol` | The terms and calendar, fixed at issuance; accepts a signed determination only when its own computation agrees (spike 3, D1) | MPL-2.0 | 7,962 |
| `src/PayingAgent.sol` | Coupons and redemptions to holders of record, reconciled on-chain; amounts the deposit cannot credit are held and claimable; coupon reversal and restatement for the controller (ADR 0014). The note's agent for burning and pausing | MPL-2.0 | 10,643 |
| `src/LockedSettlement.sol` | Delivery versus payment by locked offer (ADR 0081). The note's agent for partial freezing | MPL-2.0 | 6,775 |
| `src/GovernanceController.sol` | Every privileged power, in two tiers, through typed acts only; owner of the note's suite and its agent for amendment, correction, the supervisory freeze and wallet recovery (ADRs 0019, 0021 to 0025, 0039, 0088) | MPL-2.0 | 17,326 |

The MPL-2.0 contracts reach T-REX only through `src/interfaces/INote.sol` (ADR 0087).

`script/Scaffolding.sol` builds the shared scaffolding, `script/Onboarding.sol` onboards a client
by role, `script/Issuance.sol` issues a note on the scaffolding and `script/Governance.sol` holds
the ceremony. Each is used by its script (`DeployInstruments.s.sol`, `IssueNote.s.sol`,
`Ceremony.s.sol`) and by the tests (`test/Stack.sol`), so the tests exercise exactly what is
deployed. After the ceremony the deployer holds nothing on the note or its lifecycle; as the
Issuer it keeps T-REX's factory, to issue further notes.

```bash
forge build --sizes
forge test --force  # 80, including all 25 payoff scenarios end to end
FOUNDRY_PROFILE=fork forge test --fork-url http://127.0.0.1:8545   # governance through the real wallets
python3 test/vectors/flatten.py   # after regenerating spikes/payoff/vectors.json
```

Use `--force` after changing a contract. Forge's incremental build can leave a test running
against stale creation code for a contract it deploys, so a changed contract appears to pass.

## Contract surface

The surface under assurance review for 0.1 was defined by `surface/rc1.json`, tagged
`instruments-surface-rc1` (ADR 0026). 0.2.0 replaces that surface; its own is frozen at release.

A change to any file in the surface before the final freeze is listed, with its reason, in the
diff put to review.
