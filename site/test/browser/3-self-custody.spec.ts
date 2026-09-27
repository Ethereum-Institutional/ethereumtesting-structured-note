import { test, expect, expectHealthy, installWallet, signedIn, PEOPLE } from "./fixtures.ts";

test("self-custody: the client asks, the bank declines, the client asks again, the bank confirms, the client binds with one signature", async ({ browser }) => {
  const client = await signedIn(browser, PEOPLE.selfCustody);
  const wallet = await installWallet(client, `browser self-custody ${Date.now()}`);
  const staff = await signedIn(browser, PEOPLE.operator);

  // The client asks, entering nothing; binding waits for the bank.
  await client.goto("/admit");
  await client.getByRole("button", { name: "Ask my bank to confirm my KYB" }).click();
  await expect(client.getByText("Step 1 of 2: your bank is confirming your KYB.")).toBeVisible();
  await expect(client.getByRole("button", { name: "Bind wallet" })).toBeDisabled();

  // The bank declines the first request.
  await staff.goto("/operator");
  let panel = staff.locator("section.panel").filter({ hasText: PEOPLE.selfCustody.email });
  await panel.getByRole("button", { name: "Decline" }).click();
  await expect(staff.locator("section.panel").filter({ hasText: PEOPLE.selfCustody.email })).toHaveCount(0);
  await client.reload();
  await expect(client.getByText("Declined by the bank.")).toBeVisible();

  // Asked again, the bank chooses the client from its list and confirms.
  await client.getByRole("button", { name: "Ask my bank to confirm my KYB" }).click();
  await expect(client.getByText("Step 1 of 2")).toBeVisible();
  await staff.reload();
  panel = staff.locator("section.panel").filter({ hasText: PEOPLE.selfCustody.email });
  await panel.getByLabel("Client (corporate identity at the bank)").selectOption("KYC-TI1");
  await panel.getByLabel("Legal name").fill("Test Institution One");
  await panel.getByLabel("Jurisdiction").selectOption("LU");
  await panel.getByRole("button", { name: "Confirm the client's KYB" }).click();
  await expect(staff.locator("section.panel").filter({ hasText: PEOPLE.selfCustody.email })).toHaveCount(0);

  // The client's page updates by itself, shows the bank's reference, and binding opens.
  await expect(client.getByText("Step 2 of 2: your bank has confirmed your KYB.")).toBeVisible({ timeout: 20_000 });
  await expect(client.getByText("Your bank's reference for you: KYC-TI1")).toBeVisible();
  await client.getByLabel("Wallet address").fill(wallet);
  await client.getByRole("button", { name: "Bind wallet" }).click();
  await client.getByRole("button", { name: "Sign with browser wallet" }).click();
  await expect(client.getByText("Admitted to the conversion pool.")).toBeVisible({ timeout: 60_000 });
  await expectHealthy(client);
  await expectHealthy(staff);
});
