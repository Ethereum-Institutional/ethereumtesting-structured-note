# 0102. The site on a phone

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The owner asked for the site to work well on a phone. At 390 px wide (a common phone width), every
page worked, but:
- **The menu.** The menu took a quarter of every screen.
- **The portal tabs.** The bank portal's tabs ran off the edge, and the Agent's wrapped untidily.
- **Five pages were wider than the screen, by 300 to 700 px:** Sign-ups, Deposit, Custodians, Keys and the Ledger. Their tables' scrolling boxes stretched with the portal's layout column, which had no minimum width, so the whole page grew instead. Addresses and hashes in headings and notices, each one long word, did the same.

## Decision

**Below 720 px, the menu folds behind a "Menu" button,** and closes again when a page opens.

**Below 860 px, the portal's tabs are one strip that scrolls sideways.** Group labels are hidden
there and their links sit inline.

**Below 640 px, each table row reads as a card**, one labelled value per line. A small client
component labels each cell with its column's heading as the page renders, and labels rows added
later the same way. It also sets the table roles explicitly, because a table restyled as blocks
loses them in some browsers' accessibility trees. Without it, a table scrolls inside its own box.

**Nothing is wider than the screen:**
- the portal's column has a minimum width of zero;
- long words (addresses, hashes) break rather than stretch a heading, a notice or a value;
- form fields use 16 px text on phones, so iOS does not zoom into them.

| Option | Outcome |
|---|---|
| Cards from labels the component adds, with CSS doing the layout | **Chosen.** One change serves the site's 28 tables, and each page keeps its markup |
| Hand-written card markup for each table | Not chosen. 28 tables to keep in step with their desktop forms |
| Every table scrolling sideways in its box | Not chosen. It fits, but reading a row means scrolling |

## Consequences

**Browser spec 15** opens 19 pages at 390 px wide and fails if any scrolls sideways. It also opens
the menu, follows a link from it, checks the menu closes, and checks a table's first cell carries
its label. The desktop specs are unchanged.
