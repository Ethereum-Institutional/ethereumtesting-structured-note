# 0061. The site takes the house style of the organisation's event pages, with a crimson icon

- **Status:** Accepted (owner, 30 September 2026)
- **Date:** 30 September 2026

## Context

The owner asked for the site to follow the organisation's own event pages: colour scheme, fonts
and form. They also asked for the organisation's icon, recoloured crimson so a test site is never
mistaken for the real one.

## Options considered

| Option | Summary |
|---|---|
| The house style, with the icon recoloured | Dark warm ground, cream text, a pine header band, serif headlines over a grotesque, cream rounded buttons. The icon keeps its shape and becomes crimson. |
| Keep the previous style | Light and generic, and unlike anything else the organisation publishes. |

## Decision

One dark look throughout:
- colours: near-black `#161511`, cream `#f2efe9`, and a pine band `#1a5c4d` behind the bar and page header;
- fonts: Literata for headings and Archivo for text, both open fonts from Google Fonts;
- form: the navigation in a cream pill, and 12 px rounded cream buttons.

The icon is the organisation's, with its pine replaced by crimson `#9E1B32`
(`site/app/icon.svg`, `apple-icon.png`). The event pages' licensed faces and their logotype are
not copied.

## Why

The site reads as the organisation's own work, and the crimson icon marks it as a test at a glance.

## Consequences

- The architecture diagram takes the new colours through the same tokens.
- `docs/solution-overview.html` keeps its own style; it is a separate document.
