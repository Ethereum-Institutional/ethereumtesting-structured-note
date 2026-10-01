import { test, expect, expectHealthy, fundWallet, holderPresents, installWallet, signedIn, PEOPLE } from "./fixtures.ts";

test("holder wallet: the officer scans once, the officer's wallet signs in MetaMask, the bank approves", async ({ browser }) => {
  const client = await signedIn(browser, PEOPLE.holder);
  // The wallet reports the pool's chain while it would sign on Base: the site must switch anyway.
  const wallet = await installWallet(client, `browser officer wallet ${Date.now()}`, { reportsPoolChain: "0x7a69" });
  await client.goto("/onboard");
  await client.getByRole("button", { name: "Present from a holder wallet" }).click();
  await expect(client.getByText("Step 1 of 2: present your officer credential.")).toBeVisible();

  await holderPresents("officer");
  await expect(client.getByText("Step 2 of 2: your officer credential is verified.")).toBeVisible({ timeout: 20_000 });
  // The second step is the officer's wallet, bound by one signature (ADR 0068).
  await client.getByRole("button", { name: "Connect MetaMask and bind the officer's wallet" }).click();
  await expect(client.getByText("Received. Awaiting the bank's approval.")).toBeVisible({ timeout: 30_000 });

  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/operator/admissions");
  const row = staff.locator("#admissions + .table-wrap tbody tr").filter({ hasText: wallet });
  await row.getByRole("button", { name: "Approve and write grants" }).click();
  await expect(row.locator(".pill")).toHaveText("admitted", { timeout: 60_000 });
  await client.reload();
  await expect(client.getByRole("region", { name: "Your wallet" })).toContainText(wallet);
  await expect(client.getByRole("region", { name: "Your wallet" })).toContainText("Holder wallet");

  // S-27 from the Convert page: a quote as the amount is typed, then the approvals and the swap in MetaMask.
  await fundWallet(wallet as `0x${string}`, 50_000_000n); // 50 EURPT
  await client.getByRole("navigation", { name: "Onboard" }).getByRole("link", { name: "Convert" }).click();
  await expect(client).toHaveURL(/\/onboard\/convert$/);
  const held = client.locator(".facts dd");
  await expect(held.nth(0)).toHaveText("50.00");
  // Both tokens added to the wallet's list in a click each (EIP-747).
  await client.getByRole("button", { name: "Add EURPT to MetaMask" }).click();
  await expect(client.getByRole("status")).toContainText("EURPT is in your wallet's list");
  await client.getByRole("button", { name: "Add EURTD to MetaMask" }).click();
  await expect(client.getByRole("status")).toContainText("EURTD is in your wallet's list");
  expect(await client.evaluate(() => (window as any).__watched)).toEqual(["EURPT", "EURTD"]);
  await client.getByLabel(/^Amount of EURPT/).fill("10");
  await expect(client.getByRole("note")).toContainText(/You receive about 9\.\d\d EURTD, and at least 9\.\d\d EURTD/);
  await client.getByRole("button", { name: "Convert with MetaMask" }).click();
  await expect(client.getByRole("status").filter({ hasText: "Converted 10.000000 EURPT into at least" })).toBeVisible({ timeout: 60_000 });
  const sent = (await client.evaluate(() => (window as any).__walletCalls as string[])).filter((m) => m === "eth_sendTransaction");
  expect(sent, "two approvals, then the swap").toHaveLength(3);
  await expect(held.nth(0)).toHaveText("40.00", { timeout: 20_000 });
  await expect(held.nth(1)).toHaveText(/^9\.\d\d$/);
  await expectHealthy(client);
  await expectHealthy(staff);
});
