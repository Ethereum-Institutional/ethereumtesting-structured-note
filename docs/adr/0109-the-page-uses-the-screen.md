# 0109. The page uses the screen, and the portal's actions explain themselves

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The owner found the layout cramped on a desktop:
- **Width.** Every page was capped at 1,160 px and centred, so on a wide screen the portal's navigation sat far from the left edge, and tables squeezed into the middle. The Ledger's rows ran to five lines.
- **Menu.** The menu wrapped onto its own row under the title.
- **Actions.** Labels such as "Credit deposit…" did not say what they do.

## Decision

**The page spans the screen,** with a margin each side, up to 2,400 px. Prose keeps its own measure:
the narrow sign-in pages, the lede and notices. The portal's navigation sits at the left, and its
content takes the rest, so the Ledger's rows take two lines rather than five.

**The menu sits beside the title in one row** where the screen allows. Below 1,100 px wide, rather
than 720 px as before (ADR 0102), it folds behind the Menu button instead of wrapping. The column
of row actions needs 14rem, not 20rem.

**Every terse action label has a tooltip** saying what it does, and its cursor shows that it has
one. This covers the bank's onboarding, deposit, pool, clients and sign-ups, the onboarding agent's
revocation, and the custodian's conversion. "Credit deposit…", which said nothing even when opened,
also explains itself inside its form: it issues the bank's tokenized deposit into the wallet, as
when the client pays money into its account.

## Consequences

**Screenshots at 1024, 1440 and 1920 px** were compared before and after the change. Specs 15
(phone width) and the full browser suite run on the change.
