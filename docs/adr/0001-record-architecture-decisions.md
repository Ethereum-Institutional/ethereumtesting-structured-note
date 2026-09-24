# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 24 September 2026

## Context

Decisions on this PoC are taken option by option, often with a recommendation, and several
belong to parties outside engineering. The handoff records outcomes, but not what else was
considered or why a choice won, which is what an auditor, a second line reviewer or a later
session needs in order not to reverse a decision by accident.

## Options considered

| Option | Summary |
|---|---|
| An ADR per decision in `docs/adr/` | Numbered, one decision each, with the options and the reasoning. Durable and reviewable in the repository. |
| Keep decisions in HANDOFF.md only | One place to read, but it holds outcomes, grows without structure, and loses the alternatives. |
| Record decisions in the private working documents | Keeps them out of the tree, but separates them from the code they govern. |

## Decision

Record every design decision as an ADR in `docs/adr/`. HANDOFF.md keeps a one-line summary and points here.

## Why

The alternatives and the reasons are what stop a decision being quietly reversed (HANDOFF
section 7). Keeping them beside the code means a change and its rationale are reviewed together.
Naming discipline applies to ADRs as to everything else.

## Consequences

- A decision taken through an option review is written up in the same change as its
  implementation, or before it when the implementation is deferred.
- A decision owned by an outside party is recorded as **Proposed** until that party confirms it.
- Decisions D1 to D17 predate this practice and remain in HANDOFF section 2; they are not
  restated here.
