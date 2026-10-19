import { test, expect, expectHealthy, chooseClient, signedIn, PEOPLE } from "./fixtures.ts";

test("a third-party custodian opens the account the bank confirmed; a client can leave /onboard while it refreshes, and cancel a request", async ({ browser }) => {
  const page = await signedIn(browser, PEOPLE.applicant);
  await page.goto("/onboard");
  await page.locator("section.panel").filter({ hasText: "A third-party custodian" }).getByRole("button", { name: "Ask my bank to confirm my KYB" }).click();
  await expect(page.getByText("Your bank is confirming your KYB.")).toBeVisible();

  // The page refreshes itself while waiting; navigating away must stick.
  await page.getByRole("link", { name: "Architecture" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(6_000);
  await expect(page).toHaveURL(/\/$/);

  // Cancelled, the client can choose again.
  await page.goto("/onboard");
  await page.getByRole("button", { name: "Cancel this request" }).click();
  await expect(page.getByText(/Earlier: Third-party custodian cancelled/)).toBeVisible();

  // Asked again; the bank confirms against its record; the custodian opens the account.
  await page.locator("section.panel").filter({ hasText: "A third-party custodian" }).getByRole("button", { name: "Ask my bank to confirm my KYB" }).click();
  const bank = await signedIn(browser, PEOPLE.operator);
  await bank.goto("/bank/onboarding");
  const panel = bank.locator("section.panel").filter({ hasText: PEOPLE.applicant.email });
  await chooseClient(panel.locator('select[name="kycReference"]'), "Browser Test Institution SA");
  await panel.getByRole("button", { name: "Confirm the client's KYB" }).click();
  await expect(bank.locator("#in-progress + .table-wrap")).toContainText("the custodian to open the account", { timeout: 15_000 });
  await page.reload();
  await expect(page.getByText("Your custodian is opening your account.")).toBeVisible();

  await bank.goto("/custodian");
  const waiting = bank.locator("section.panel").filter({ hasText: PEOPLE.applicant.organisation });
  await waiting.getByRole("button", { name: "Open the account" }).click();
  await expect(bank.locator("section").filter({ hasText: "Held by the third-party custodian" }).locator("tbody tr")).toHaveCount(1, { timeout: 90_000 });
  await expect(page.getByRole("region", { name: "Third-party custodian" })).toContainText("eligible, until", { timeout: 20_000 });
  await expectHealthy(page);
  await expectHealthy(bank);
});
