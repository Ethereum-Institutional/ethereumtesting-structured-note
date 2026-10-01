import { test, expect, expectHealthy, chooseClient, signedIn, PEOPLE } from "./fixtures.ts";

const LEGAL_NAME = "Browser Test Institution SA";

test("staff add a corporate client once, warned before a jurisdiction the pool refuses; the bank issues it", async ({ browser }) => {
  const page = await signedIn(browser, PEOPLE.operator);
  await page.goto("/operator");
  // The navigation column leads to each part of the console (ADR 0073).
  await page.getByRole("navigation", { name: "Operator" }).getByRole("link", { name: "Clients" }).click();
  await expect(page).toHaveURL(/\/operator\/clients$/);
  // The bank's own client, issued elsewhere, is listed to be re-issued here (ADR 0066).
  await expect(page.getByText("Issued outside this site")).toBeVisible();
  const form = page.locator("form").filter({ has: page.getByLabel("Registration number") });

  await form.getByLabel("Jurisdiction").selectOption({ label: "United States of America - US" });
  await expect(form.getByRole("alert")).toContainText("United States of America (US) is outside the pool's jurisdictions");
  await form.getByLabel("Jurisdiction").selectOption("LU");
  await expect(form.getByRole("alert")).toHaveCount(0);

  // No reference to type: the site assigns it (ADR 0067).
  await expect(form.getByLabel("Client reference at the bank")).toHaveCount(0);
  await form.getByLabel("Legal name").fill(LEGAL_NAME);
  await form.getByLabel("Legal form").selectOption("PLC");
  await form.getByLabel("Registration number").fill("B 998 877");
  await form.getByLabel("Incorporation date").fill("2003-04-05");
  await form.getByRole("button", { name: "Add client and issue its corporate identity" }).click();
  await expect(form.getByRole("status")).toContainText(`Added ${LEGAL_NAME} as CLI-`);
  const reference = (await form.getByRole("status").innerText()).match(/as (CLI-\d{6}-[A-Z2-9]{4})/)![1];

  const row = page.locator("#clients + .panel tbody tr").filter({ hasText: reference });
  await expect(row).toContainText(`did:elabify:local:client:${reference}`);
  await expect(row).toContainText(/pending anchor|anchored/);
  await expectHealthy(page);
});

test("staff admit a custodied client in one action, through a lagging RPC, within the time budget", async ({ browser }) => {
  const page = await signedIn(browser, PEOPLE.operator);
  await page.goto("/operator/custody/custodial");
  const form = page.locator("#custodied + .panel form");
  // Only the client: its facts come from Clients, and the site assigns the references (ADRs 0066, 0067).
  await expect(form.getByLabel("Custody account reference")).toHaveCount(0);
  await chooseClient(form.locator('select[name="kycReference"]'), LEGAL_NAME);

  const started = Date.now();
  await form.getByRole("button", { name: "Admit" }).click();
  // The page says it is working while the transactions confirm.
  await expect(form.getByRole("status")).toContainText("This takes up to a minute");
  await expect(form.getByRole("status")).toHaveCount(0, { timeout: 60_000 }); // the account is opened and bound

  await page.getByRole("navigation", { name: "Operator" }).getByRole("link", { name: "Admissions" }).click();
  const row = page.locator("#admissions + .table-wrap tbody tr").first();
  // First the wallet credential waits for the bank's anchor; the page moves it on by itself (ADR 0060).
  await expect(row.locator(".pill")).toHaveText("awaiting-anchor");
  await expect(row).toContainText("Waiting for the bank to anchor");

  // Meanwhile the bank's own act does not take over the staff member's onboarding page (ADR 0062).
  const own = await signedIn(browser, PEOPLE.operator);
  await own.goto("/onboard");
  // Nothing of the custodied admission appears there: no status, no progress, no error.
  await expect(own.locator("section.panel").filter({ hasText: /Almost there|could not be completed|Admitted to the conversion pool|writing/ })).toHaveCount(0);
  await expect(own.getByRole("button", { name: "Ask my bank to confirm my KYB" })).toBeEnabled();
  await expect(own.getByRole("button", { name: "Present from a holder wallet" })).toBeEnabled();
  await own.close();
  await expect(row.locator(".pill")).toHaveText("admitted", { timeout: 60_000 });
  expect(Date.now() - started, "a custodied admission completes within 30 s on one-second blocks").toBeLessThan(30_000);
  await expect(row).toContainText("Custodial");
  // Pool grant, registry grant and trading approvals: each a transaction (plain on the local chain, which has no explorer).
  // Pool grant, registry grant, trading approvals, and the two anchoring transactions (the
  // corporate identity's earlier batch and the wallet credential's).
  expect((await row.innerText()).match(/0x[0-9a-f]{8}…/g) ?? [], "five transactions recorded").toHaveLength(5);

  // S-27 for a custody account: the bank credits the deposit, then the custodian converts it (ADR 0070).
  await row.getByText("Credit deposit…").click();
  await row.getByLabel("Amount of EURTD").fill("5");
  await row.getByRole("button", { name: "Credit", exact: true }).click();
  await expect(row).toContainText(/Last credit: 5\.00 EURTD, BKG-/, { timeout: 30_000 });
  await row.getByText("Convert…").click();
  await row.locator('select[name="direction"]').selectOption("into-payment");
  await row.getByLabel("Amount", { exact: true }).fill("3");
  await row.getByRole("button", { name: "Convert", exact: true }).click();
  await expect(row).toContainText(/Last conversion: 3\.00 EURTD into EURPT/, { timeout: 30_000 });

  // Offboarding asks for a reason, says what the corporate identity's revocation would withdraw,
  // and leaves the row offboarded with both revocations linked (ADRs 0063, 0064).
  await row.getByText("Revoke at the bank…").click();
  await expect(row).toContainText("withdraws the KYB for 1 admitted wallet");
  await row.getByText("Offboard…").click();
  await row.getByLabel("Reason").first().fill("Client closed its account");
  await row.getByRole("button", { name: "Offboard", exact: true }).click();
  await expect(row.locator(".pill")).toHaveText("offboarded", { timeout: 30_000 });
  await expect(row).toContainText("Offboarded by operator@example.org");
  await expect(row).toContainText("Client closed its account");

  await page.getByRole("link", { name: "Onboard" }).click();
  await expect(page).toHaveURL(/\/onboard$/);
  await expectHealthy(page);
});
