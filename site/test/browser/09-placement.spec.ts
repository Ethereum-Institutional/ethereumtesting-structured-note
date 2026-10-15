import { test, expect, expectHealthy, fundWallet, installWallet, setEth, signedIn, PEOPLE } from "./fixtures.ts";
import { SELF_CUSTODY_SEED } from "./people.ts";

test("the note refuses a wallet until the onboarding agent vouches for it; the client then accepts the Issuer's offer in MetaMask", async ({ browser }) => {
  test.setTimeout(300_000);
  // The self-custody client of spec 03: eligible for the deposit, not yet for the note.
  const client = await signedIn(browser, PEOPLE.selfCustody);
  const wallet = await installWallet(client, SELF_CUSTODY_SEED);
  await fundWallet(wallet as `0x${string}`, 1n); // ETH for its fees

  // S-09: the note refuses an account the onboarding agent has not vouched for, before anything is sent.
  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/agent/notes");
  await staff.getByRole("link", { name: /Series 2/ }).click();
  await expect(staff).toHaveURL(/\/agent\/notes\/note_/);
  const notePage = staff.url();
  const place = staff.locator("#place-2 + .panel");
  const option = place.locator('select[name="admission"] option', { hasText: wallet.slice(0, 10) });
  await expect(option).toContainText("(not eligible for the note)");
  const account = await option.getAttribute("value");
  await place.locator('select[name="admission"]').selectOption(account!);
  await place.getByLabel("Units").fill("2");
  await place.getByRole("button", { name: "Place units" }).click();
  await expect(place.getByRole("alert")).toContainText("buyer is not eligible for the note");

  // The client asks; the onboarding agent approves; the bank credits the deposit to pay with.
  await client.goto("/onboard");
  const card = client.getByRole("region", { name: "Self-custody" });
  await card.getByText("Ask for access to the note…").click();
  await card.getByLabel(/not a U.S. person/).check();
  await card.getByLabel(/rely on our bank's KYB/).check();
  await card.getByRole("button", { name: "Ask for access to the note" }).click();
  await staff.goto("/onboarding");
  const ask = staff.locator("section.panel").filter({ hasText: wallet });
  await ask.getByRole("button", { name: "Approve for the note" }).click();
  await expect(staff.locator("section.panel").filter({ hasText: wallet })).toHaveCount(0, { timeout: 60_000 });
  await staff.goto("/bank/onboarding");
  const row = staff.locator("#onboarded + .table-wrap tbody tr").filter({ hasText: wallet });
  await row.getByText("Credit deposit…").click();
  await row.getByLabel("Amount").fill("2500");
  await row.getByRole("button", { name: "Credit", exact: true }).click();
  await expect(row.getByRole("status")).toContainText(/Credited 2500\.00 EURTD/, { timeout: 30_000 });

  // S-08: offered, for the client to accept from its own wallet.
  await staff.goto(notePage);
  await place.locator('select[name="admission"]').selectOption(account!);
  await place.getByLabel("Units").fill("2");
  await place.getByRole("button", { name: "Place units" }).click();
  await expect(place.getByRole("status").filter({ hasText: /Offer \d+ made/ })).toBeVisible({ timeout: 30_000 });

  // The client sees it waiting, and accepts in two transactions.
  await client.reload();
  const nav = client.getByRole("navigation", { name: "Onboard" });
  await expect(nav.getByRole("link", { name: /Notes/ })).toContainText("1");
  await nav.getByRole("link", { name: /Notes/ }).click();
  const offer = client.getByRole("region", { name: "Offered to you" });
  await expect(offer).toContainText("€2,000.00, €1,000.00 a unit");
  // With no ETH for fees, nothing is sent: the page says what the wallet needs (ADR 0080).
  await setEth(wallet, 0n);
  await offer.getByRole("button", { name: "Accept with MetaMask" }).click();
  await expect(offer.getByRole("alert")).toContainText("Your wallet holds 0 ETH; these 2 transactions need about");
  expect((await client.evaluate(() => (window as any).__walletCalls as string[])).filter((m) => m === "eth_sendTransaction")).toHaveLength(0);
  await setEth(wallet, 10n ** 18n);
  await offer.getByRole("button", { name: "Accept with MetaMask" }).click();
  // Settled, the offer leaves the list: the units are held, and the offer is listed as settled.
  const holding = client.getByRole("region", { name: "Held" });
  await expect(holding.getByRole("row").filter({ hasText: "EURWAN2" }).getByRole("cell").nth(1)).toHaveText("2", { timeout: 60_000 });
  await expect(offer).toContainText("No offer is open.");
  await holding.getByText(/Earlier offers/).click();
  await expect(holding.getByRole("listitem").filter({ hasText: "2 units of EURWAN2 for €2,000.00" })).toContainText("settled");
  await staff.goto(notePage);
  await expect(staff.locator('[aria-label="Offers"] tbody tr').first().locator(".pill")).toHaveText("settled");
  await expectHealthy(client);
  await expectHealthy(staff);
});
