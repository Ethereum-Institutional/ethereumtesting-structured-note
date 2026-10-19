import { test, expect, expectHealthy, chooseClient, installWallet, signedIn, PEOPLE } from "./fixtures.ts";
import { SELF_CUSTODY_SEED } from "./people.ts";

test("self-custody: the bank declines, the client asks again, the bank confirms, the client signs once and holds its identity", async ({ browser }) => {
  // The bank's record of the client first.
  const bank = await signedIn(browser, PEOPLE.banker);
  await bank.goto("/bank/clients");
  const form = bank.locator("form").filter({ has: bank.getByLabel("Registration number") });
  await form.getByLabel("Legal name").fill("Browser Test Institution SA");
  await form.getByLabel("Legal form").selectOption("PLC");
  await form.getByLabel("Registration number").fill("B 112 233");
  await form.getByLabel("Jurisdiction").selectOption("LU");
  await form.getByLabel("Incorporation date").fill("2010-01-02");
  await form.getByRole("button", { name: "Add client" }).click();
  await expect(form.getByRole("status")).toContainText("Added Browser Test Institution SA");

  const client = await signedIn(browser, PEOPLE.selfCustody);
  const wallet = await installWallet(client, SELF_CUSTODY_SEED, { declineFirstSignature: true });
  await client.goto("/onboard");
  const card = () => client.locator("section.panel").filter({ hasText: "Self-custody" }).first();
  await card().getByRole("button", { name: "Ask my bank to confirm my KYB" }).click();
  await expect(client.getByText("Your bank is confirming your KYB.")).toBeVisible();

  // The bank declines the first request.
  await bank.goto("/bank/onboarding");
  let panel = bank.locator("section.panel").filter({ hasText: PEOPLE.selfCustody.email });
  await panel.getByText("Decline…").click();
  await panel.getByLabel("Reason").fill("Wrong entity");
  await panel.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(bank.locator("section.panel").filter({ hasText: PEOPLE.selfCustody.email })).toHaveCount(0, { timeout: 15_000 });
  await client.reload();
  await expect(client.getByText(/Earlier: Self-custody declined/)).toBeVisible();

  // Asked again, the bank chooses the client from its records and confirms.
  await card().getByRole("button", { name: "Ask my bank to confirm my KYB" }).click();
  await bank.reload();
  panel = bank.locator("section.panel").filter({ hasText: PEOPLE.selfCustody.email });
  await chooseClient(panel.locator('select[name="kycReference"]'), "Browser Test Institution SA");
  await panel.getByRole("button", { name: "Confirm the client's KYB" }).click();
  await expect(bank.locator("#in-progress + .table-wrap")).toContainText("the client's wallet signature", { timeout: 15_000 });

  // One click: the wallet's address is read, the chain added and switched to, and the message
  // proposed for signature. Declined the first time, the same button tries again.
  await client.reload();
  await client.getByRole("button", { name: "Connect MetaMask and sign" }).click();
  await expect(client.getByRole("alert").filter({ hasText: "You declined in the wallet" })).toBeVisible();
  await client.getByRole("button", { name: "Connect MetaMask and sign" }).click();
  const account = client.getByRole("region", { name: "Self-custody" });
  await expect(account).toContainText(wallet, { timeout: 90_000 });
  await expect(account).toContainText("managed by your wallet");
  await expect(account).toContainText("eligible, until");
  const calls: string[] = await client.evaluate(() => (window as any).__walletCalls);
  expect(calls).toEqual(expect.arrayContaining(["eth_requestAccounts", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_signTypedData_v4"]));

  // The bank revokes its claim at once, then renews it.
  await bank.goto("/bank/onboarding");
  const row = bank.locator("#onboarded + .table-wrap tbody tr").filter({ hasText: wallet });
  await row.getByText("Revoke the bank's claim…").click();
  await row.getByLabel("Reason").first().fill("Screening hit under review");
  await row.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(row.getByRole("status")).toContainText("can no longer hold or receive the deposit", { timeout: 30_000 });
  // The client's page reads the chain as it is: reloaded until a lagging RPC shows the revocation.
  await expect(async () => {
    await client.reload();
    await expect(account).toContainText("not eligible (revoked)", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await bank.reload();
  const renewed = bank.locator("#onboarded + .table-wrap tbody tr").filter({ hasText: wallet });
  await renewed.getByText("Renew the bank's claim…").click();
  await renewed.getByRole("button", { name: "Renew", exact: true }).click();
  await expect(renewed.getByRole("status")).toContainText("Renewed", { timeout: 30_000 });
  await expect(async () => {
    await client.reload();
    await expect(account).toContainText("eligible, until", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });

  // The client asks to close its account: holding nothing yet, the request stands; the bank
  // sees it with its reason; withdrawn, it is gone, and the account stays for the specs after this one.
  await client.reload();
  await account.getByText("Close this account…").click();
  await account.getByLabel("Reason").fill("Consolidating accounts");
  await account.getByRole("button", { name: "Ask to close" }).click();
  await expect(account).toContainText("You asked to close this account", { timeout: 30_000 });
  await bank.goto("/bank/onboarding");
  const asked = bank.locator("#onboarded + .table-wrap tbody tr").filter({ hasText: wallet });
  await expect(asked).toContainText("asked to close");
  await expect(asked).toContainText("Consolidating accounts");
  await expect(asked.getByRole("button", { name: "Close the account as asked" })).toBeVisible();
  await account.getByRole("button", { name: "Withdraw the request" }).click();
  await expect(account.getByText("Close this account…")).toBeVisible();
  await bank.reload();
  await expect(bank.locator("#onboarded + .table-wrap tbody tr").filter({ hasText: wallet })).not.toContainText("asked to close");

  // With an identity on the chain, the client's registration cannot be deleted, not even by an admin:
  // the wallet is offboarded first.
  const admin = await signedIn(browser, PEOPLE.operator);
  await admin.goto("/bank");
  const signUp = admin.getByRole("row").filter({ hasText: PEOPLE.selfCustody.email });
  await signUp.getByText("Delete…").click();
  await signUp.getByRole("button", { name: "Delete permanently" }).click();
  await expect(signUp.getByRole("alert")).toContainText("has an identity on the chain");
  await admin.reload();
  await expect(admin.getByRole("row").filter({ hasText: PEOPLE.selfCustody.email })).toHaveCount(1);
  await expectHealthy(client);
  await expectHealthy(bank);
  await expectHealthy(admin);
});
