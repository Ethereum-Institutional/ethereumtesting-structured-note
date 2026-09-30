import "server-only";

/**
 * The site's navigation bar as a string, for injection into documents served whole, such as the
 * solution overview. It mirrors app/Bar.tsx. The styles use the overview's own tokens, so it
 * follows the overview's theme, and they move the overview's sticky contents column and anchor
 * offsets down by the bar's height.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `<style>
:root { --sitebar-h: 3.25rem; }
body { margin: 0; }
.sitebar {
  position: sticky; top: 0; z-index: 40; height: var(--sitebar-h);
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 0 var(--pad); background: var(--bg); border-bottom: 1px solid var(--border);
  font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg3);
}
.sitebar nav { display: flex; gap: 1.25rem; align-items: center; white-space: nowrap; overflow-x: auto; }
.sitebar a { color: var(--fg2); text-decoration: none; }
.sitebar a:hover, .sitebar a[aria-current] { color: var(--accent); }
.sitebar form { margin: 0; }
.sitebar button {
  font: inherit; letter-spacing: inherit; text-transform: inherit; color: var(--fg2); background: transparent;
  border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 0.4rem 0.65rem; cursor: pointer;
}
.toc { top: var(--sitebar-h); max-height: calc(100vh - var(--sitebar-h)); }
section { scroll-margin-top: calc(var(--sitebar-h) + 1.5rem); }
@media (max-width: 1040px) { .toc { inset: var(--sitebar-h) 0 0 auto; max-height: none; } }
@media (max-width: 720px) { .sitebar .who, .sitebar .title { display: none; } }
@media print { .sitebar { display: none !important; } }
</style>`;

export function siteBar(email: string, operator: boolean): string {
  return `${STYLE}
<header class="sitebar">
  <span class="title">Structured Note Technical PoC</span>
  <nav aria-label="Site">
    <a href="/">Architecture</a>
    <a href="/overview" aria-current="page">Solution overview</a>
    <a href="/onboard">Onboard</a>
    ${operator ? '<a href="/operator">Operator</a>' : ""}
    <span class="who">${esc(email)}</span>
    <form method="post" action="/signout"><button type="submit">Sign out</button></form>
  </nav>
</header>`;
}
