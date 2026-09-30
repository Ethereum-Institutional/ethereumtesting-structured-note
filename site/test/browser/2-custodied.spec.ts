import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";

const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

test("staff are warned before submitting a jurisdiction or screening date the pool refuses", async ({ browser }) => {
  const page = await signedIn(browser, PEOPLE.operator);
  await page.goto("/operator");
  const form = page.locator("form").filter({ has: page.getByLabel("Custody account reference") });

  await form.getByLabel("Jurisdiction").selectOption({ label: "United States of America - US" });
  await expect(form.getByRole("alert")).toContainText("United States of America (US) is outside the pool's jurisdictions");
  await form.getByLabel("Jurisdiction").selectOption("LU");
  await expect(form.getByRole("alert")).toHaveCount(0);

  await form.getByLabel("Last sanctions screening").fill(day(2));
  await expect(form.getByRole("alert")).toContainText("in the future");
  await form.getByLabel("Last sanctions screening").fill(day(-45));
  await expect(form.getByRole("alert")).toContainText("older than 30 days");
  await form.getByLabel("Last sanctions screening").fill(day(0));
  await expect(form.getByRole("alert")).toHaveCount(0);
  await expectHealthy(page);
});

test("staff admit a custodied client in one action, through a lagging RPC, within the time budget", async ({ browser }) => {
  const page = await signedIn(browser, PEOPLE.operator);
  await page.goto("/operator");
  const form = page.locator("form").filter({ has: page.getByLabel("Custody account reference") });
  const ref = `SEG-${Date.now()}`;
  await form.getByLabel("Client (corporate identity at the bank)").selectOption("KYC-TI1");
  await form.getByLabel("Custody account reference").fill(ref);
  await form.getByLabel("Client instruction reference").fill(`INS-${ref}`);
  await form.getByLabel("Legal name").fill("Test Institution One");
  await form.getByLabel("Jurisdiction").selectOption("LU");
  await form.getByLabel("Last sanctions screening").fill(day(0));

  const started = Date.now();
  await form.getByRole("button", { name: "Admit" }).click();
  // The page says it is working while the transactions confirm.
  await expect(form.getByRole("status")).toContainText("This takes up to a minute");

  const row = page.locator("#admissions + .table-wrap tbody tr").first();
  // First the wallet credential waits for the bank's anchor; the page moves it on by itself (ADR 0060).
  await expect(row.locator(".pill")).toHaveText("awaiting-anchor");
  await expect(row).toContainText("Waiting for the bank to anchor");
  await expect(row.locator(".pill")).toHaveText("admitted", { timeout: 60_000 });
  expect(Date.now() - started, "a custodied admission completes within 30 s on one-second blocks").toBeLessThan(30_000);
  await expect(row).toContainText("custodied");
  // Pool grant, registry grant and trading approvals: each a transaction (plain on the local chain, which has no explorer).
  // Pool grant, registry grant, trading approvals, and the two anchoring transactions (the
  // corporate identity's earlier batch and the wallet credential's).
  expect((await row.innerText()).match(/0x[0-9a-f]{8}…/g) ?? [], "five transactions recorded").toHaveLength(5);
  await expectHealthy(page);
});
