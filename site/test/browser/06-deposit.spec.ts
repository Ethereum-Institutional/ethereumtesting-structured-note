import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";

const HELD = "Browser Held Institution SA";

test("the bank's deposit: credit, hold, a debit refused past the hold, debit, a move by order with its reason, and the pause", async ({ browser }) => {
  test.setTimeout(240_000);
  const bank = await signedIn(browser, PEOPLE.banker);
  await bank.goto("/bank");
  await bank.getByRole("navigation", { name: "The bank" }).getByRole("link", { name: "Deposit" }).click();
  await expect(bank).toHaveURL(/\/bank\/deposit$/);
  await expect(bank.getByRole("region", { name: "The deposit's state" }).locator(".pill")).toHaveText("moving");

  // The account of spec 02, held by the bank's custody platform, which holds by the bank's claim.
  // Matched on the account's own cell: every row's "Move by order" list names the other holders.
  const row = () => bank.locator("tr[data-account]").filter({ has: bank.locator("td:first-child", { hasText: HELD }) });
  await expect(row()).toContainText("the bank's claim");
  const act = async (summary: string, fill: (r: ReturnType<typeof row>) => Promise<void>, button: string) => {
    await row().getByText(summary).click();
    await fill(row());
    await row().getByRole("button", { name: button, exact: true }).click();
  };

  await act("Credit…", (r) => r.getByLabel("Amount").first().fill("10"), "Credit");
  await expect(row().getByRole("status").filter({ hasText: /Credited 10\.00 EURTD, booking BKG-/ })).toBeVisible({ timeout: 60_000 });

  await act("Hold…", async (r) => {
    await r.getByLabel("Amount held").fill("4");
    await r.getByLabel("Reason").first().fill("Browser test: dispute under review");
  }, "Set the hold");
  await expect(row().getByRole("status").filter({ hasText: "Held 4.00 EURTD" })).toBeVisible({ timeout: 60_000 });

  // More than is free of the hold is refused, in words.
  await bank.reload();
  await expect(row().locator(".held")).toHaveText("4.00 EURTD");
  await act("Debit…", (r) => r.locator('form:has(button:text-is("Debit")) input[name="amount"]').fill("1000"), "Debit");
  await expect(row().getByRole("alert")).toContainText("does not hold that much free of any hold", { timeout: 60_000 });
  await row().locator('form:has(button:text-is("Debit")) input[name="amount"]').fill("2");
  await row().getByRole("button", { name: "Debit", exact: true }).click();
  await expect(row().getByRole("status").filter({ hasText: /Debited 2\.00 EURTD, booking BKG-/ })).toBeVisible({ timeout: 60_000 });

  // A move by order takes the held amount, its reason recorded on-chain.
  await bank.reload();
  await row().getByText("Move by order…").click();
  const to = await row().locator('select[name="to"] option', { hasText: "Investor A" }).getAttribute("value");
  await row().locator('select[name="to"]').selectOption(to!);
  await row().locator('form:has(button:text-is("Move by order")) input[name="amount"]').fill("4");
  await row().getByLabel("The order and its reason").fill("Browser test: court order 2026/118, attachment in favour of Investor A");
  await row().getByRole("button", { name: "Move by order", exact: true }).click();
  await expect(row().getByRole("status").filter({ hasText: "Moved 4.00 EURTD by order" })).toBeVisible({ timeout: 60_000 });

  // The pause stops everything; resumed, it moves.
  const state = bank.getByRole("region", { name: "The deposit's state" });
  await state.getByText("Pause the deposit…").click();
  await state.getByLabel("Reason").fill("Browser test: incident drill");
  await state.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(state.getByRole("status")).toContainText("Paused", { timeout: 60_000 });
  await bank.reload();
  await expect(state.locator(".pill")).toHaveText("paused");
  await state.getByText("Resume the deposit…").click();
  await state.getByLabel("Reason").fill("Browser test: drill over");
  await state.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(state.getByRole("status")).toContainText("Resumed", { timeout: 60_000 });

  // The bank's record: the debit by its booking, and the order with its reason.
  await bank.reload();
  await expect(state.locator(".pill")).toHaveText("moving");
  await expect(bank.locator("#bookings + .table-wrap tbody tr").filter({ hasText: "debit" }).first()).toContainText(/BKG-\d{6}-[0-9A-F]{8}/);
  await expect(bank.locator("#orders + .table-wrap")).toContainText("court order 2026/118");
  await expectHealthy(bank);
});
