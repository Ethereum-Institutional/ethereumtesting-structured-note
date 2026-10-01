import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";

test("the Ledger shows every approved user the lifecycle from the chain; only staff see the register reconciliation", async ({ browser }) => {
  const client = await signedIn(browser, PEOPLE.selfCustody);
  await client.goto("/onboard");
  await client.getByRole("link", { name: "Ledger" }).click();
  await expect(client).toHaveURL(/\/ledger$/);
  const rows = client.locator(".table-wrap tbody tr");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(10);
  await expect(client.getByText("unrecognised", { exact: true })).toHaveCount(0);
  await expect(client.getByRole("heading", { name: "Register reconciliation" })).toHaveCount(0);
  await expectHealthy(client);

  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/ledger");
  await expect(staff.getByRole("heading", { name: "Register reconciliation" })).toBeVisible();
  await expect(staff.locator("#register ~ .table-wrap tbody tr").first()).toBeVisible();
  await expectHealthy(staff);
});
