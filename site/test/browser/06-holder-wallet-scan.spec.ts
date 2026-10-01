import { getAddress, keccak256, toBytes } from "viem";
import { test, expect, expectHealthy, holderPresents, signedIn, PEOPLE } from "./fixtures.ts";

test("holder wallet, another way: the wallet-control credential is presented by a second scan", async ({ browser }) => {
  const wallet = getAddress(`0x${keccak256(toBytes(`browser holder wallet ${Date.now()}`)).slice(26)}`);
  const client = await signedIn(browser, PEOPLE.holder);
  await client.goto("/onboard");
  // Onboarded once already (the spec before): the client binds a new wallet, by the same route (ADR 0069).
  await expect(client.getByRole("button", { name: "Present from a holder wallet" })).toHaveCount(0);
  await client.getByRole("button", { name: "Bind a new wallet" }).click();
  await expect(client.getByText("Step 1 of 2: present your officer credential.")).toBeVisible();
  await holderPresents("officer");
  await expect(client.getByText("Step 2 of 2: your officer credential is verified.")).toBeVisible({ timeout: 20_000 });
  await client.getByText("Or present a wallet-control credential from the holder wallet").click();
  await expect(client.getByText("Scan with the holder wallet.")).toBeVisible();
  await holderPresents("wallet", wallet);
  await expect(client.getByText("Received. Awaiting the bank's approval.")).toBeVisible({ timeout: 20_000 });

  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/operator/admissions");
  // The wallet it replaces is listed too, "replaced by" this one: this admission's own row is the other.
  const row = staff.locator("#admissions + .table-wrap tbody tr").filter({ hasText: wallet, hasNotText: "replaced by" });
  await row.getByRole("button", { name: "Approve and write grants" }).click();
  await expect(row.locator(".pill")).toHaveText("admitted", { timeout: 60_000 });
  await expectHealthy(client);
  await expectHealthy(staff);
});
