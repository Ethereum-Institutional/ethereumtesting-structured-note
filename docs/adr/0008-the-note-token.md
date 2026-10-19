# 0008. The note token

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Each note must enforce, at every transfer, who may hold it, when it may move, and who may act on
it with special powers. Those rules should come from an established security-token standard that
reviewers already know, and nothing should be able to change a note's logic once issued.

## Decision

**Each note is an ERC-3643 token, a T-REX 5.0.0-beta2 suite,** issued by the note factory
(record 0009):
- **The token**, decimals zero: a balance is a count of units, each one Calculation Amount.
- **Its own ONCHAINID identity**, carrying the note's term sheet claim and series claim.
- **Its identity registry**, on the deployment's shared identity storage, requiring the note
  claim (record 0005). It has no agents of its own: it reads the storage and never writes to it.
- **Its trusted issuers and claim topics registries.**
- **Its compliance**, carrying two modules, both our own:
  - the note's record-date module (record 0011);
  - the programme's sanctions module, shared by every note (record 0017).

**Logic fixed for good: `FixedImplementationAuthority`.** T-REX's proxies ask an implementation
authority where their logic is, on every call. T-REX's own authority can add and switch versions,
and in 5.0.0-beta2 one of its entry points does so without checking its owner, so anyone could
switch the logic behind every token. Our authority answers the same six questions and nothing else:
it cannot add a version, switch one, or move a proxy.

**Agents limited to their own powers.** T-REX lets each agent's powers be switched off one by one.
Every power is off, then only what each agent needs is on (`AgentPowers`):

| Agent | Powers |
|---|---|
| The note's Paying Agent | Burn, at redemption; pause, when a redemption opens |
| The note's settlement contract | Partial freeze and unfreeze, while an offer is open |
| The governance controller | Mint and burn (inventory only, by governance act), forced transfer, address freeze, wallet recovery, pause (on the servicing wallet's word) |

The factory is an agent only while it issues, and removes itself before the transaction ends.

**Owned by the governance controller from its first block.** The token, its registries and its
compliance are handed to the controller, which accepts them in the issuing transaction, and the
controller manages the note's identity (records 0009, 0014). The Issuer holds no power over a note
once issued: its inventory is a holder like any other.

## Consequences

- A transfer is refused, before it moves, when the receiver lacks a valid note claim, either party
  is frozen or designated, the note is paused, or the record dates have stopped transfers.
- A note's powers can be exercised only through the controller's typed acts, so the complete set
  is readable in one contract.
- An issued note runs the logic it was issued with, whatever happens to T-REX's own authority.
