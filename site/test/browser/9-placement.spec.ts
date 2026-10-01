import { test, expect, expectHealthy, fundWallet, installWallet, signedIn, PEOPLE } from "./fixtures.ts";

test("a client binds a new wallet; the note refuses it until staff approve it under Reg S; the client accepts the offer in MetaMask, unbinds, and asks for custody", async ({ browser }) => {
  test.setTimeout(300_000);
  // The third-party client of spec 3, onboarded; its KYB stands, so a new wallet needs one signature.
  const client = await signedIn(browser, PEOPLE.selfCustody);
  const wallet = await installWallet(client, `browser placement wallet ${Date.now()}`);
  await fundWallet(wallet as `0x${string}`, 1n); // ETH for its fees
  await client.goto("/onboard");
  const card = client.getByRole("region", { name: "Your wallet" });
  const previous = (await card.locator("code").innerText()).trim();
  await card.getByRole("button", { name: "Bind a new wallet" }).click();
  await client.getByRole("button", { name: "Connect MetaMask and bind this wallet" }).click();
  await expect(card).toContainText(wallet, { timeout: 60_000 });
  // One wallet per KYB: the one it replaced is listed as earlier.
  await client.reload();
  await client.getByText(/Earlier wallets/).click();
  await expect(client.getByRole("row").filter({ hasText: previous })).toContainText(`replaced by ${wallet}`);
  await expect(card).toContainText("Not yet approved");

  // S-09: the note refuses an account not approved under Reg S, before anything is sent.
  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/operator/notes");
  const place = staff.locator("#place-2");
  const account = await place.locator('select[name="admission"] option', { hasText: wallet.slice(0, 10) }).getAttribute("value");
  await place.locator('select[name="admission"]').selectOption(account!);
  await place.getByLabel("Units").fill("2");
  await place.getByRole("button", { name: "Place units" }).click();
  await expect(place.getByRole("alert")).toContainText("lacks the Reg S flag (S-09)");

  // Staff approve it, and the bank credits the deposit to pay with.
  await staff.goto("/operator/admissions");
  // The wallet's admitted row (an earlier binding attempt of the same wallet may be listed too).
  const row = staff.locator("#admissions + .table-wrap tbody tr").filter({ hasText: wallet }).filter({ has: staff.locator(".pill", { hasText: /^admitted$/ }) });
  await row.getByText("Approve for the note…").click();
  await row.getByLabel(/not a U\.S\. person/).check();
  await row.getByRole("button", { name: "Approve for the note" }).click();
  await expect(row).toContainText("Approved for the note under Reg S by operator@example.org", { timeout: 30_000 });
  await row.getByText("Credit deposit…").click();
  await row.getByLabel("Amount of EURTD").fill("2500");
  await row.getByRole("button", { name: "Credit", exact: true }).click();
  await expect(row).toContainText(/Last credit: 2500\.00 EURTD/, { timeout: 30_000 });

  // S-08: offered, for the client to accept from its own wallet.
  await staff.goto("/operator/notes");
  await place.locator('select[name="admission"]').selectOption(account!);
  await place.getByLabel("Units").fill("2");
  await place.getByRole("button", { name: "Place units" }).click();
  await expect(place.getByRole("status").filter({ hasText: "Offered as trade" })).toBeVisible({ timeout: 30_000 });

  // The client sees it waiting, and accepts in two transactions.
  await client.reload();
  const nav = client.getByRole("navigation", { name: "Onboard" });
  await expect(nav.getByRole("link", { name: /Notes/ })).toContainText("1");
  await nav.getByRole("link", { name: /Notes/ }).click();
  const offer = client.getByRole("region", { name: "Offered to you" });
  await expect(offer).toContainText("€2,000.00, €1,000.00 a unit");
  await offer.getByRole("button", { name: "Accept with MetaMask" }).click();
  // Settled, the offer leaves the list: the units are held, and the offer is listed as settled.
  const holding = client.getByRole("region", { name: "Held" });
  await expect(holding.getByRole("row").filter({ hasText: "EURWAN2" }).getByRole("cell").nth(1)).toHaveText("2", { timeout: 60_000 });
  await expect(offer).toContainText("No offer is open.");
  await holding.getByText(/Earlier offers/).click();
  await expect(holding.getByRole("listitem").filter({ hasText: "2 units of EURWAN2 for €2,000.00" })).toContainText("settled");
  await staff.reload();
  await expect(place.locator("tbody tr").first().locator(".pill")).toHaveText("settled");

  // The client unbinds the wallet itself (ADR 0076): its grants go at once, its KYB stands.
  await nav.getByRole("link", { name: "Account" }).click();
  await card.getByText("Unbind this wallet…").click();
  await card.getByLabel(`Unbind ${wallet}`).check();
  await card.getByRole("button", { name: "Unbind", exact: true }).click();
  await expect(client.getByRole("heading", { name: "No account onboarded" })).toBeVisible({ timeout: 30_000 });
  await expect(card).toHaveCount(0);

  // Then asks the bank to hold the account in custody; staff admit it from the request.
  await client.getByRole("button", { name: "Ask my bank to hold it in custody" }).click();
  await expect(client.getByText(/You asked your bank to hold your account in custody/)).toBeVisible();
  await staff.goto("/operator/custody/custodial");
  await expect(staff.getByRole("navigation", { name: "Operator" }).getByRole("link", { name: "Custodial (1)" })).toBeVisible();
  const request = staff.locator("#custody-requests + .table-wrap tbody tr").filter({ hasText: PEOPLE.selfCustody.email });
  await request.getByRole("button", { name: "Admit" }).click();
  await expect(staff.locator("#custody-requests")).toHaveCount(0, { timeout: 60_000 });
  // The custody account waits for the bank's anchor; the Admissions page moves it on.
  await staff.goto("/operator/admissions");
  await expect(staff.locator("#admissions + .table-wrap tbody tr").first().locator(".pill")).toHaveText("admitted", { timeout: 60_000 });

  const held = client.getByRole("region", { name: "Held in custody" });
  await expect(async () => {
    await client.reload();
    await expect(held).toBeVisible();
  }).toPass({ timeout: 60_000 });
  await expect(client.getByText(/You asked your bank/)).toHaveCount(0);
  await expectHealthy(client);
  await expectHealthy(staff);
});
