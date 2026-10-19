import { test, expect, expectHealthy, chooseClient, signedIn, PEOPLE } from "./fixtures.ts";

const LEGAL_NAME = "Browser Held Institution SA";

test("the bank adds a client once; its facts stay in the bank's records, and only their hash is shown", async ({ browser }) => {
  const page = await signedIn(browser, PEOPLE.banker);
  await page.goto("/bank");
  await page.getByRole("navigation", { name: "The bank" }).getByRole("link", { name: "Clients" }).click();
  await expect(page).toHaveURL(/\/bank\/clients$/);
  const form = page.locator("form").filter({ has: page.getByLabel("Registration number") });
  // No reference to type: the site assigns it.
  await expect(form.getByLabel("Client reference at the bank")).toHaveCount(0);
  await form.getByLabel("Legal name").fill(LEGAL_NAME);
  await form.getByLabel("Legal form").selectOption("PLC");
  await form.getByLabel("Registration number").fill("B 998 877");
  await form.getByLabel("Jurisdiction").selectOption("LU");
  await form.getByLabel("Incorporation date").fill("2003-04-05");
  await form.getByRole("button", { name: "Add client" }).click();
  await expect(form.getByRole("status")).toContainText(`Added ${LEGAL_NAME} as CLI-`);
  const reference = (await form.getByRole("status").innerText()).match(/as (CLI-\d{6}-[A-Z2-9]{4})/)![1];
  const row = page.locator("#clients + .panel tbody tr").filter({ hasText: reference });
  await expect(row).toContainText(/0x[0-9a-f]{8}…/, { timeout: 10_000 });
  await expectHealthy(page);
});

test("bank custody: the client asks, the bank confirms, the custody platform opens the account; the onboarding agent approves the note", async ({ browser }) => {
  const client = await signedIn(browser, PEOPLE.custodied);
  await client.goto("/onboard");
  const card = client.locator("section.panel").filter({ hasText: "Bank custody" }).first();
  await card.getByRole("button", { name: "Ask my bank to confirm my KYB" }).click();
  await expect(client.locator(".progress li.current")).toHaveText(/Your bank confirms your KYB/);

  // The bank confirms: one action opens the account, creates its identity and adds the bank's claim.
  const bank = await signedIn(browser, PEOPLE.banker);
  await bank.goto("/bank/onboarding");
  const request = bank.locator("section.panel").filter({ hasText: PEOPLE.custodied.email });
  await chooseClient(request.locator('select[name="kycReference"]'), LEGAL_NAME);
  const started = Date.now();
  await request.getByRole("button", { name: "Confirm the client's KYB" }).click();
  // Done, the request leaves the queue and the account joins the onboarded list.
  const row = bank.locator("#onboarded + .table-wrap tbody tr").filter({ hasText: LEGAL_NAME });
  await expect(row).toBeVisible({ timeout: 90_000 });
  expect(Date.now() - started, "within the time budget, through a lagging RPC").toBeLessThan(60_000);
  await expect(row).toContainText("Bank custody");
  await expect(row.locator(".pill").first()).toContainText("until");

  // The client's page updates by itself: its account is eligible for the deposit; it asks for the note.
  const account = client.getByRole("region", { name: "Bank custody" });
  await expect(account).toContainText("eligible, until", { timeout: 20_000 });
  await account.getByText("Ask for access to the notes…").click();
  await account.getByLabel(/not a U.S. person/).check();
  await account.getByRole("button", { name: "Ask for access to the notes" }).click();
  await expect(account).toContainText("asked; the onboarding agent decides", { timeout: 20_000 });

  // The onboarding agent sees the bank's claim stands and the answers, never the bank's record.
  const agent = await signedIn(browser, PEOPLE.operator);
  await agent.goto("/onboarding");
  const ask = agent.locator("section.panel").filter({ hasText: LEGAL_NAME });
  await expect(ask).toContainText("Relied on, while the bank's claim stands");
  await expect(ask).not.toContainText("B 998 877");
  await ask.getByRole("button", { name: "Approve for the notes" }).click();
  await expect(agent.locator("section.panel").filter({ hasText: LEGAL_NAME })).toHaveCount(0, { timeout: 60_000 });
  await expect(account.locator(".pill").nth(1)).toContainText("eligible, until", { timeout: 20_000 });

  // The bank credits its deposit to the account.
  await bank.reload();
  const again = bank.locator("#onboarded + .table-wrap tbody tr").filter({ hasText: LEGAL_NAME });
  await again.getByText("Credit deposit…").click();
  await again.getByLabel("Amount").fill("5");
  await again.getByRole("button", { name: "Credit", exact: true }).click();
  await expect(again.getByRole("status")).toContainText(/Credited 5\.00 EURTD, booking BKG-/, { timeout: 30_000 });

  // The Agent sees the account, its identity and who vouched, and no client facts.
  await agent.goto("/agent");
  const participant = agent.locator("#participants ~ .table-wrap tbody tr").filter({ hasText: "Bank custody" }).first();
  await expect(participant.locator(".pill")).toHaveCount(2);
  await expect(agent.getByText(LEGAL_NAME)).toHaveCount(0);

  // The custodians' portal lists the account under the bank's custody platform.
  await agent.goto("/custodian");
  await expect(agent.locator("section").filter({ hasText: "Held by the bank's custody platform" }).locator("tbody tr")).toHaveCount(1);
  for (const p of [client, bank, agent]) await expectHealthy(p);
});
