# 0114. Tier 1 names the note it governs, and its accounts by client

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The owner found Tier 1's "Correct the register" confusing: which note does it move?
- **The note.** It is the deployment's own note, EUR Worst-of Autocallable Note (EURWAN), the only one the governance controller owns (ADRs 0082, 0088). The page called it only "the note under review".
- **Notes issued from the site.** Series 2 onwards are owned by the note factory for the Issuer (ADR 0091), and are not governed there at all.
- **The account lists.** The From and To lists showed the deployment file's internal keys ("investorA", "SEG-0001"). They left out every account onboarded on the site, so a client such as EU Corp could not be chosen.

## Decision

**The Tier 1 page states the note it acts on** at the top: name, symbol and address, linked to the
explorer, with its units outstanding and in the Issuer's inventory. It says plainly that notes
issued from the site are not governed there. The action reads "Correct the register of EURWAN…".

**The account lists name every account a forced transfer could reach:**
- the deployment's parties, by capacity ("Investor A");
- its custody accounts, by reference;
- every account onboarded on the site, by the bank's client it was confirmed against, with its route (ADR 0110).

## Consequences

**A gap, recorded rather than closed.** A site-issued note's register cannot be corrected, nor a
lost wallet recovered, from the site. Its agent role for forced transfers belongs to the Issuer,
through the factory's `administer`, and the site offers no such act. Closing it would mean either:
- handing each issued note to the controller (the factory's `handOver`), so Tier 1 governs every note; or
- a Tier 1 act per note through the factory.

Either is a decision for the owner.

**Tests.** Browser spec 13 checks the page names the deployment's own note, and corrects, recovers
and freezes accounts chosen by their readable names. The governance integration tests are unchanged.
