# 0026. Freeze the instruments as a release candidate now, finally after confirmation

- **Status:** Accepted (Wave 4)
- **Date:** 25 September 2026

## Context

The plan freezes and tags the contract surface after the ceremony, so that assurance reviews a
fixed version. Six payoff clauses (C2, C3, C6, C7, C9, C10) await the Issuer and the Calculation
Agent, and a changed answer is a code change. Wave 5 will change the venue, which is a separate
compilation unit.

## Options considered

| Option | Summary |
|---|---|
| Candidate now, final later | Tag the instruments' surface as a release candidate; freeze finally after C1 to C10 and naming sign-off; freeze the venue after Wave 5. |
| Final freeze now | Tag as final now; any later change is a new version with a fresh freeze and review. |
| Wait for everything | One freeze of the whole surface once every answer is in and Wave 5 is done. |

## Decision

Tag the instruments' surface as `instruments-surface-rc1`, defined by a surface file listing
every in-scope source file and its hash, each deployable contract's runtime code hash, the
compiler settings and the debt standard's pin, with a script that checks a working tree against
it. The final freeze follows confirmation of C1 to C10 and naming sign-off. The venue's surface is
frozen separately after Wave 5.

## Why

Assurance can start now against a fixed version, and a changed confirmation becomes a small
diff reviewed against the candidate rather than a restart. Waiting for outside parties would
delay the approvals that already have the longest lead time; a final freeze now would almost
certainly be superseded.

## Consequences

- Any change to a file in the surface after the candidate must be listed, with its reason, in
  the diff put to review before the final tag.
- The surface covers the instruments unit only; the venue is out of scope until its own freeze.
