import "server-only";

/**
 * The site's navigation bar as a string, for injection into documents served whole, such as the
 * solution overview. It mirrors app/Bar.tsx. The styles use the overview's own tokens, so it
 * follows the overview's theme, and they move the overview's sticky contents column and anchor
 * offsets down by the bar's height.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `<style>
:root { --sitebar-h: 4.5rem; }
body { margin: 0; }
/* As app/Bar.tsx: a pine band, the title in the serif, the navigation in a cream pill (ADR 0061). */
.sitebar {
  position: sticky; top: 0; z-index: 40; height: var(--sitebar-h);
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 0 var(--pad); background: var(--pine, #1a5c4d);
  font-family: var(--sans); font-size: 0.9375rem;
}
.sitebar .title { font-family: var(--disp); font-size: 1.125rem; color: var(--cream, #f2efe9); }
.sitebar nav {
  display: flex; gap: 0.25rem 1.1rem; align-items: center; white-space: nowrap; overflow-x: auto;
  background: var(--cream, #f2efe9); border-radius: 12px; padding: 0.5rem 0.6rem 0.5rem 1.1rem;
}
.sitebar a { color: var(--ink, #14130f); text-decoration: none; font-weight: 500; }
.sitebar a:hover, .sitebar a[aria-current] { text-decoration: underline; }
.sitebar .who { color: rgba(20, 19, 15, 0.6); font-size: 0.8125rem; }
.sitebar form { margin: 0; }
.sitebar button {
  font: inherit; font-size: 0.875rem; color: var(--ink, #14130f); background: transparent;
  border: 1px solid rgba(20, 19, 15, 0.25); border-radius: 12px; padding: 0.45rem 0.85rem; cursor: pointer;
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
    <a href="/ledger">Ledger</a>
    ${operator ? '<a href="/operator">Operator</a>' : ""}
    <span class="who">${esc(email)}</span>
    <form method="post" action="/signout"><button type="submit">Sign out</button></form>
  </nav>
</header>`;
}
