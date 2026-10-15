import { test, expect, expectHealthy, fundWallet, installWallet, signedIn, PEOPLE } from "./fixtures.ts";
import { SELF_CUSTODY_SEED } from "./people.ts";

const HELD = "Browser Held Institution SA";

test("the pool refuses a wallet until the bank admits it; the client converts in MetaMask, the custody platform for its client; a revocation stops it", async ({ browser }) => {
  test.setTimeout(300_000);
  // The self-custody client of spec 03: the deposit accepts its wallet; the pool does not, yet.
  const client = await signedIn(browser, PEOPLE.selfCustody);
  const wallet = await installWallet(client, SELF_CUSTODY_SEED);
  await fundWallet(wallet as `0x${string}`, 1_000_000_000n); // EUR 1,000 of the payment token, and ETH for fees
  await client.goto("/onboard/convert");
  await expect(client.locator(".pool-standing")).toContainText("does not admit your wallet yet: no valid pool-access claim");
  await expect(client.getByRole("button", { name: "Convert with MetaMask" })).toHaveCount(0);

  // The bank admits it, as an institutional investor.
  const staff = await signedIn(browser, PEOPLE.banker);
  await staff.goto("/bank");
  await staff.getByRole("navigation", { name: "The bank" }).getByRole("link", { name: "Conversion pool" }).click();
  await expect(staff).toHaveURL(/\/bank\/pool$/);
  const row = staff.locator(`tr[data-wallet="${wallet}"]`);
  await expect(row.locator(".pool-standing")).toHaveText("no valid pool-access claim");
  await row.getByText("Admit…").click();
  await row.getByLabel("Investor class").selectOption("institutional");
  await row.getByRole("button", { name: "Admit to the pool" }).click();
  await expect(staff.locator(`tr[data-wallet="${wallet}"] .pool-standing`)).toHaveText("admitted", { timeout: 60_000 });

  // The client's pages say so, and it converts from its own wallet: two approvals, then the swap.
  await client.goto("/onboard");
  await expect(client.getByRole("region", { name: "Self-custody" })).toContainText("admitted, until");
  await client.goto("/onboard/convert");
  await expect(client.locator(".pool-standing")).toContainText("The pool admits your wallet");
  await client.getByLabel(/Amount of/).fill("100");
  await expect(client.getByRole("note")).toContainText("You receive about", { timeout: 20_000 });
  await client.getByRole("button", { name: "Convert with MetaMask" }).click();
  await expect(client.getByRole("status")).toContainText(/Converted 100(\.0+)? EURPT into at least/, { timeout: 90_000 });

  // The custody platform converts for the account of spec 02, once the bank admits it.
  await staff.reload();
  const held = staff.locator("tbody tr").filter({ hasText: HELD });
  await held.getByText("Admit…").click();
  await held.getByRole("button", { name: "Admit to the pool" }).click();
  await expect(staff.locator("tbody tr").filter({ hasText: HELD }).locator(".pool-standing")).toHaveText("admitted", { timeout: 60_000 });
  const custody = await signedIn(browser, PEOPLE.operator);
  await custody.goto("/custodian");
  const account = custody.locator("section").filter({ hasText: "Held by the bank's custody platform" }).locator("tbody tr").filter({ hasText: "admitted" });
  await account.getByText("Convert…").click();
  await account.getByLabel("Direction").selectOption("into-payment");
  await account.getByLabel("Amount paid").fill("2");
  await account.getByRole("button", { name: "Convert for the client" }).click();
  await expect(account.getByRole("status")).toContainText(/Converted 2\.00 EURTD into EURPT/, { timeout: 60_000 });

  // A revocation stops the wallet at once; the deposit still accepts it.
  await staff.goto("/bank/pool");
  const again = staff.locator(`tr[data-wallet="${wallet}"]`);
  await again.getByText("Revoke…").click();
  await again.getByLabel("Reason").fill("Screening alert under review");
  await again.getByRole("button", { name: "Revoke pool access" }).click();
  await expect(staff.locator(`tr[data-wallet="${wallet}"] .pool-standing`)).toHaveText("no valid pool-access claim", { timeout: 60_000 });
  await client.goto("/onboard/convert");
  await expect(client.locator(".pool-standing")).toContainText("does not admit your wallet yet");
  await client.goto("/onboard");
  await expect(client.getByRole("region", { name: "Self-custody" }).locator(".pill").first()).toContainText("eligible, until");
  for (const p of [client, staff, custody]) await expectHealthy(p);
});
