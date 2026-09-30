import { getAddress, keccak256, toBytes } from "viem";
import { test, expect, expectHealthy, holderPresents, signedIn, PEOPLE } from "./fixtures.ts";

test("holder wallet: two scans, then the bank approves and both grants are written", async ({ browser }) => {
  const wallet = getAddress(`0x${keccak256(toBytes(`browser holder wallet ${Date.now()}`)).slice(26)}`);
  const client = await signedIn(browser, PEOPLE.holder);
  await client.goto("/onboard");
  await client.getByRole("button", { name: "Present from a holder wallet" }).click();
  await expect(client.getByText("Step 1 of 2: present your officer credential.")).toBeVisible();

  await holderPresents("officer");
  await expect(client.getByText("Step 2 of 2: present the wallet-control credential.")).toBeVisible({ timeout: 20_000 });
  await holderPresents("wallet", wallet);
  await expect(client.getByText("Received. Awaiting the bank's approval.")).toBeVisible({ timeout: 20_000 });

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
