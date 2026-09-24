# 0002. Strip the inherited console, keep its chain plumbing

- **Status:** Accepted (Wave 1)
- **Date:** 24 September 2026

## Context

The source repository carried a ~10,000-line console built for a different product on the
securities-identity standard retired by D4, with vendor branding and hosting scripts that pointed at
the source vendor's deployment. HANDOFF section 6 listed hazards in it: an admin domain defaulting
to the vendor, a watchdog keyed to page copy, an activity feed that silently dropped rows.

## Options considered

| Option | Summary |
|---|---|
| Strip it, keep the plumbing | Delete the console; move the sound chain plumbing (signer queue, nonce self-heal, calldata decoder) into a tested library, fixing the section 6 hazards there. |
| Keep and de-brand it | Keep it running on the retired standard until Wave 2, re-skin and patch it. |
| Strip it entirely | Delete it and its plumbing; rebuild from nothing in Wave 3. |

## Decision

Strip the console and its hosting. Carry the chain plumbing into `site/lib/chain/`, corrected.

## Why

De-branding and patching screens that Waves 2 and 3 would replace is wasted work, and the hosting
scripts could act on another party's deployment. The plumbing, by contrast, encodes real lessons
(nonce ordering, receipt timeouts) that are cheaper to keep than to relearn.

## Consequences

- The operations console is built on the gated site from Wave 3 onward.
- The audit tape, price maths and manifest loading are rebuilt as tested modules (ADR 0017).
- The source console survives only in history.
