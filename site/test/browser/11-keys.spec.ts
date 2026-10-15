import { test, expect, expectHealthy, setEth, signedIn, PEOPLE } from "./fixtures.ts";

test("a key low on ETH is warned about on every staff portal, and staff top it up from the Keys page", async ({ browser }) => {
  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/agent/keys");
  const row = staff.getByRole("row").filter({ hasText: "Deposit Agent" });
  const address = (await row.getByRole("cell").nth(1).innerText()).trim(); // plain text locally: no explorer
  await expect(row.locator(".pill")).toHaveText("ok");
  await expect(staff.getByRole("row").filter({ hasText: "Servicing wallet owner 1" }).locator(".pill")).toHaveText("signs only");

  await setEth(address, 1000n);
  await expect(async () => {
    await staff.reload();
    await expect(row.locator(".pill")).toHaveText("empty");
    await expect(staff.getByRole("alert").filter({ hasText: "Low on ETH for fees" })).toContainText("Deposit Agent");
  }).toPass({ timeout: 45_000 });
  // The warning follows staff to every staff portal, with the count in the navigation.
  await staff.getByRole("navigation", { name: "The Agent" }).getByRole("link", { name: /Notes/ }).click();
  await expect(staff.getByRole("alert").filter({ hasText: "Low on ETH for fees" })).toContainText("Deposit Agent");
  await expect(staff.getByRole("navigation", { name: "The Agent" }).getByRole("link", { name: /Keys/ })).toContainText("1");

  await staff.getByRole("link", { name: "Top up under Agent → Keys" }).click();
  await row.getByRole("button", { name: "Top up" }).click();
  await expect(async () => {
    await staff.reload();
    await expect(row.locator(".pill")).toHaveText("ok");
  }).toPass({ timeout: 45_000 });
  await expect(staff.getByRole("alert").filter({ hasText: "Low on ETH for fees" })).toHaveCount(0);
  await expectHealthy(staff);
});
