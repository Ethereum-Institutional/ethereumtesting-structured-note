import { test, expect, expectHealthy, holderPresents, installWallet, signedIn, PEOPLE } from "./fixtures.ts";

test("holder wallet: the officer scans once, the officer's wallet signs in MetaMask, the bank approves", async ({ browser }) => {
  const client = await signedIn(browser, PEOPLE.holder);
  const wallet = await installWallet(client, `browser officer wallet ${Date.now()}`);
  await client.goto("/onboard");
  await client.getByRole("button", { name: "Present from a holder wallet" }).click();
  await expect(client.getByText("Step 1 of 2: present your officer credential.")).toBeVisible();

  await holderPresents("officer");
  await expect(client.getByText("Step 2 of 2: your officer credential is verified.")).toBeVisible({ timeout: 20_000 });
  // The second step is the officer's wallet, bound by one signature (ADR 0068).
  await client.getByRole("button", { name: "Connect MetaMask and bind the officer's wallet" }).click();
  await expect(client.getByText("Received. Awaiting the bank's approval.")).toBeVisible({ timeout: 30_000 });

  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/operator");
  const row = staff.locator("#admissions + .table-wrap tbody tr").filter({ hasText: wallet });
  await row.getByRole("button", { name: "Approve and write grants" }).click();
  await expect(row.locator(".pill")).toHaveText("admitted", { timeout: 60_000 });
  await client.reload();
  await expect(client.getByText("Admitted to the conversion pool.")).toBeVisible();
  await expectHealthy(client);
  await expectHealthy(staff);
});
