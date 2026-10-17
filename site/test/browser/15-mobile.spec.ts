import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";

/** Every page at a phone's width (ADR 0102): nothing wider than the screen, the menu behind a button, tables as cards. */
const PAGES: Array<[string, keyof typeof PEOPLE | null]> = [
  ["/", null], ["/access?email=someone%40example.org", null], ["/", "operator"], ["/onboard", "selfCustody"],
  ["/bank", "operator"], ["/bank/clients", "operator"], ["/bank/deposit", "operator"], ["/bank/onboarding", "operator"], ["/bank/pool", "operator"],
  ["/onboarding", "operator"], ["/custodian", "operator"],
  ["/agent", "operator"], ["/agent/book", "operator"], ["/agent/notes", "operator"], ["/agent/reconciliation", "operator"], ["/agent/governance/tier-1", "operator"],
  ["/agent/governance/tier-2", "operator"], ["/agent/keys", "operator"], ["/agent/audit", "operator"], ["/ledger", "operator"],
];

test("on a phone, no page is wider than the screen; the menu opens from its button; a table's rows read as labelled cards", async ({ browser }) => {
  test.setTimeout(300_000);
  for (const [path, who] of PAGES) {
    const page = who ? await signedIn(browser, PEOPLE[who]) : await (await browser.newContext()).newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await page.waitForLoadState("load");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), { message: `${path} fits the screen` }).toBe(0);
    await expectHealthy(page);
    await page.context().close();
  }

  const page = await signedIn(browser, PEOPLE.operator);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/bank");
  const menu = page.locator("#site-menu");
  await expect(menu).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(menu.getByRole("link", { name: "Ledger" })).toBeVisible();
  await menu.getByRole("link", { name: "Ledger" }).click();
  await expect(page).toHaveURL(/\/ledger$/);
  await expect(page.locator("#site-menu")).toBeHidden();
  await page.goto("/bank");
  const firstCell = page.locator("table tbody tr").first().locator("td").first();
  await expect(firstCell).toHaveAttribute("data-label", "Status");
  await expectHealthy(page);
});
