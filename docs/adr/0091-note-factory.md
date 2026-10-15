# 0091. The note factory: a note issued whole in one transaction, owned by the factory for the Issuer

- **Status:** Accepted (owner, 15 October 2026), as workstream 3 of 0.2.0
- **Date:** 15 October 2026

## Context

The bank's call asked for one master template and a factory: the supporting contracts are shared
scaffolding, and a factory issues a token for each deal (plan 0.2.0). After ADR 0088, a note was
issued on the scaffolding through T-REX's factory, but its lifecycle was then attached piece by
piece. From the site, a note took nineteen transactions: the terms, the record dates, the suite,
the term sheet, the Paying Agent, the settlement contract, two transactions per agent, the bank's
allowlisting and funding, the Agent's approval, the minting and the opening.

## Decision

The owner chose all four as recommended.

### What the one act covers: the Issuer's whole part

`NoteFactory.issue` does, in one transaction:
1. fixes the terms in a Determination Agent;
2. deploys the record-date module;
3. issues the T-REX suite: token, identity, identity registry requiring the onboarding agent's note claim, and compliance carrying the record dates;
4. states the term sheet on the note's identity;
5. deploys the Paying Agent and the settlement contract;
6. makes the Issuer, the Paying Agent, the settlement contract and any agent named at issuance agents of the note, each restricted to its own powers (ADR 0085);
7. mints the notional to the Issuer's inventory;
8. opens the note for transfers.

The bank's and the Agent's parts stay their own acts, because one key cannot sign for three
institutions:
- **The bank:** allowlists the Paying Agent and the settlement contract, in one call (`setAllowlistedMany`, new on the deposit), and funds the Agent.
- **The Agent:** lets the Paying Agent draw its funds.

The site's issuance is now **four transactions**: the Issuer's one, the bank's two and the Agent's
one.

*Rejected:*
- **The factory allowlisting for the bank.** The bank would have to delegate its deposit's allowlist role to a contract.
- **Suite and lifecycle only,** with minting and opening left as separate transactions.

### The shape: a factory and two small deployers

The lifecycle contracts' creation code totals about 34 KB, more than one contract may hold. The
factory calls two deployers:
- `TermsDeployer`: the Determination Agent and the record-date module;
- `ServicingDeployer`: the Paying Agent and the settlement contract.

Every lifecycle contract keeps its constructor and immutables unchanged, and each note gets its own
contracts. The restrictions each agent gets are one library, `AgentPowers`, which the factory, the
ceremony and the tests share.

*Rejected:* clones of implementations. They are cheaper per note, but every lifecycle contract
would have had to be rewritten as initialisable, changing contracts that are already tested.

### Who issues: the Issuer alone

The factory has one owner, the Issuer (two-step ownership). It owns T-REX's factory, so no note is
issued around it. It keeps a record of every note it issued, with each note's contracts
(`notes`, `noteOf`, `NoteIssued`), for the Ledger and reconciliation.

*Rejected:* a list of issuers. Nothing in the proof of concept needs a second issuer yet.

### Who owns a note: the factory, for the Issuer

T-REX initialises each contract with its owner, and every later handover is two-step. If the
factory wired a note and then handed it to the Issuer, the Issuer would need five more transactions
to accept it. So the factory stays the owner of the note's token, identity registry, trusted
issuers, claim topics and compliance, and the manager of its identity:
- **`administer`:** the Issuer acts as owner through this call, which reaches that note's own contracts and nothing else, and passes back any refusal whole.
- **`handOver`:** offers every one of the note's contracts to a new owner, who accepts them, and moves the identity's management to it. The ceremony uses it to hand the main note to the governance controller.
- **No standing agent power:** the factory is an agent of a note only within `issue`, and removes itself before it returns.

*Rejected:* the Issuer accepting ownership after every issuance, at five transactions a note.

## Consequences

- **The site deploys no contract.** `site/lib/notes/artifacts.json` and the script that exported it are removed, along with the site signer's deploy function.
- **The ceremony** administers the main note through the factory: the controller and the servicing wallet added, the Issuer removed. It then hands the note over in one call.
- **The manifest** records `identity.noteFactory`. The tape names the factory's acts.
- **The deployer, as the Issuer, keeps the note factory** after the ceremony, to issue further notes. The factory holds nothing of a note once it has handed it over.
- **Tests:**
  - `instruments/test/NoteFactory.t.sol` covers the one transaction, the note claim, the term sheet, the eligible inventory, the Issuer alone, a salt used once, administration limited to the note's own contracts, the hand-over, the record, and the bank's one call;
  - the site's notes integration test issues a note in four steps and reads what the factory leaves.
