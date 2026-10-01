import { test, expect, expectHealthy, chooseClient, installWallet, signedIn, PEOPLE } from "./fixtures.ts";

test("third-party wallet: the client asks, the bank declines, the client asks again, the bank confirms, the client binds with one signature", async ({ browser }) => {
  const client = await signedIn(browser, PEOPLE.selfCustody);
  const wallet = await installWallet(client, `browser self-custody ${Date.now()}`, { declineFirstSignature: true });
  const staff = await signedIn(browser, PEOPLE.operator);

  // The client asks, entering nothing; binding waits for the bank.
  await client.goto("/onboard");
  await expect(client.locator(".progress li.current")).toHaveText(/Complete bank onboarding/);
  await client.getByRole("button", { name: "Ask my bank to confirm my KYB" }).click();
  await expect(client.getByText("Step 1 of 2: your bank is confirming your KYB.")).toBeVisible();
  await expect(client.getByRole("button", { name: "Bind wallet" })).toBeDisabled();

  // The bank declines the first request.
  // The route is shown as Third party (ADR 0074); its old address still works.
  await staff.goto("/operator/custody/self-custody");
  await expect(staff).toHaveURL(/\/operator\/custody\/third-party$/);
  await expect(staff.getByRole("heading", { name: "Third-party requests" })).toBeVisible();
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
  // Only the client: its facts come from Clients (ADR 0066).
  await chooseClient(panel.locator('select[name="kycReference"]'), "Browser Test Institution SA");
  await panel.getByRole("button", { name: "Confirm the client's KYB" }).click();
  await expect(staff.locator("section.panel").filter({ hasText: PEOPLE.selfCustody.email })).toHaveCount(0);

  // The client's page updates by itself, shows the bank's reference, and binding opens.
  await expect(client.getByText("Step 2 of 2: your bank has confirmed your KYB.")).toBeVisible({ timeout: 20_000 });
  await expect(client.getByText(/Your bank's reference for you: CLI-\d{6}-[A-Z2-9]{4}, Browser Test Institution SA/)).toBeVisible();
  // One click: the wallet's address is read, the pool's chain added and switched to, and the
  // bank's message proposed for signature (ADR 0068).
  await client.getByRole("button", { name: "Connect MetaMask and bind this wallet" }).click();
  // Declined the first time: the page says so, and the same button tries again.
  await expect(client.getByRole("alert").filter({ hasText: "You declined in the wallet" })).toBeVisible();
  await client.getByRole("button", { name: "Connect MetaMask and bind this wallet" }).click();
  await expect(client.getByText("Almost there: waiting for your bank to anchor the credential")).toBeVisible({ timeout: 30_000 });
  // Admitted, the request gives way to the account card (ADR 0076).
  const card = client.getByRole("region", { name: "Your wallet" });
  await expect(card).toContainText(wallet, { timeout: 60_000 });
  const calls: string[] = await client.evaluate(() => (window as any).__walletCalls);
  expect(calls).toEqual(expect.arrayContaining(["eth_requestAccounts", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_signTypedData_v4"]));

  // Onboarded: the client binds a new wallet beside the current one rather than starting over (ADR 0069).
  await client.reload();
  await expect(card).toContainText("Third-party wallet");
  await expect(client.locator(".progress")).toHaveCount(0);
  await expect(client.getByRole("button", { name: "Ask my bank to confirm my KYB" })).toHaveCount(0);
  await expect(card).toContainText("once a new wallet or a custody account is onboarded, this wallet is unbound");
  await expect(card.getByRole("button", { name: "Ask my bank to hold it in custody" })).toBeVisible();
  await card.getByRole("button", { name: "Bind a new wallet" }).click();
  // Straight to the signing stage: the bank's confirmation still stands.
  await expect(client.locator(".progress li.current")).toHaveText(/Sign message from wallet/);
  await expect(client.getByRole("button", { name: "Connect MetaMask and bind this wallet" })).toBeVisible();
  await client.getByRole("button", { name: "Cancel this request" }).click();
  await expect(card.getByRole("button", { name: "Bind a new wallet" })).toBeVisible();
  await expectHealthy(client);
  await expectHealthy(staff);
});
