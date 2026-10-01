import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";

test("staff issue a demonstration note; the page carries the issuance to the end, and the Ledger names its contracts", async ({ browser }) => {
  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/operator#notes");
  const form = staff.locator("#notes + .panel form");
  const scenario = form.locator('select[name="scenario"]');
  const value = await scenario.locator("option", { hasText: "early redemption" }).first().getAttribute("value");
  await scenario.selectOption(value!);
  await form.locator('select[name="spacing"]').selectOption("5");
  await form.getByLabel("Units").fill("10");
  await form.getByRole("button", { name: "Issue" }).click();

  const row = staff.locator("#notes + .panel tbody tr").filter({ hasText: "EURWAN2" });
  await expect(row).toContainText("issuing");
  await expect(row.locator(".pill")).toHaveText("issued", { timeout: 120_000 });
  await expect(row).toContainText("Date 4:");
  await expect(row).toContainText("payingAgent:");

  await staff.goto("/ledger");
  await expect(staff.getByText("EURWAN2 Paying Agent").first()).toBeVisible();
  await expect(staff.getByText("unrecognised", { exact: true })).toHaveCount(0);
  await expectHealthy(staff);
});
