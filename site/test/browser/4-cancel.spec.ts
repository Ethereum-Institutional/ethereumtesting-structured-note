import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";

test("a client can leave /admit while it refreshes, and cancel the holder-wallet route to choose another", async ({ browser }) => {
  const page = await signedIn(browser, PEOPLE.holder);
  await page.goto("/admit");
  await page.getByRole("button", { name: "Present from a holder wallet" }).click();
  await expect(page.getByText("Scan with the holder wallet.")).toBeVisible();

  // The page refreshes itself while waiting; navigating away must stick.
  await page.getByRole("link", { name: "Architecture" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(6_000);
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/admit");
  await page.getByRole("button", { name: "Cancel and choose another way" }).click();
  await expect(page.getByText("You cancelled this request.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask my bank to confirm my KYB" })).toBeVisible();
  await expectHealthy(page);
});
