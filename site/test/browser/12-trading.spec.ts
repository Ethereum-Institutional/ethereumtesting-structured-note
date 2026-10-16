import { test, expect, expectHealthy, fundWallet, installWallet, signedIn, PEOPLE } from "./fixtures.ts";
import type { Locator, Page } from "@playwright/test";
import { SELF_CUSTODY_SEED } from "./people.ts";

/** The bank custody client of spec 02, onboarded for the deposit and approved for the note. */
const SECOND = "Browser Held Institution SA";

/** The bank credits its deposit to an onboarded account, from its row on the bank's Onboarding page. */
async function credit(staff: Page, holder: string, amount: string) {
  await staff.goto("/bank/onboarding");
  const row = staff.locator("#onboarded + .table-wrap tbody tr").filter({ hasText: holder });
  await row.getByText("Credit deposit…").click();
  await row.getByLabel("Amount").fill(amount);
  await row.getByRole("button", { name: "Credit", exact: true }).click();
  await expect(row.getByRole("status")).toContainText(new RegExp(`Credited ${amount}\\.00 EURTD`), { timeout: 30_000 });
}

/** Chooses, in a select, the option whose text contains `text`. */
async function pick(select: Locator, text: string) {
  await select.selectOption((await select.locator("option", { hasText: text }).first().getAttribute("value"))!);
}

async function status(page: Page | Locator, text: RegExp | string) {
  await expect(page.getByRole("status").filter({ hasText: text })).toBeVisible({ timeout: 60_000 });
}

test("transfers settle by locked offer: arranged by the bank, open offers taken, a buy-back into the inventory, and the inventory cancelled no further than it holds", async ({ browser }) => {
  test.setTimeout(480_000);
  const staff = await signedIn(browser, PEOPLE.operator);

  // A note to trade, issued 30 minutes apart so that no date arrives meanwhile.
  await staff.goto("/agent/notes");
  const form = staff.locator("#notes + .panel form");
  await form.locator('select[name="scenario"]').selectOption((await form.locator('select[name="scenario"] option', { hasText: "redemption at €1000.00" }).last().getAttribute("value"))!);
  await form.getByLabel("Observations (coupon dates)").fill("4");
  await form.getByLabel("Time between observations").fill("30");
  await form.getByLabel("Unit", { exact: true }).selectOption("minutes");
  await form.getByLabel("Units").fill("10");
  await form.getByRole("button", { name: "Issue" }).click();
  const noteRow = staff.locator("#notes + .panel tbody tr").filter({ hasText: "EURWAN3" });
  await expect(noteRow.locator(".pill")).toHaveText("issued", { timeout: 150_000 });

  // The custody account of spec 02 and the wallet of specs 03 and 09, both approved for the note.
  await credit(staff, SECOND, "5000");
  const client = await signedIn(browser, PEOPLE.selfCustody);
  const wallet = await installWallet(client, SELF_CUSTODY_SEED);
  await fundWallet(wallet as `0x${string}`, 1n);
  await credit(staff, wallet, "5000");

  // Placement with both: the custody account accepts at once; the wallet in MetaMask.
  await staff.goto("/agent/notes");
  await noteRow.getByRole("link", { name: /Series 3/ }).click();
  await expect(staff).toHaveURL(/\/agent\/notes\/note_/);
  const notePage = staff.url();
  const place = staff.locator("#place-3 + .panel");
  await pick(place.locator('select[name="admission"]'), SECOND);
  await place.getByLabel("Units").fill("3");
  await place.getByRole("button", { name: "Place units" }).click();
  await status(place, /Settled: 3 units/);
  await pick(place.locator('select[name="admission"]'), wallet.slice(0, 10));
  await place.getByLabel("Units").fill("2");
  await place.getByRole("button", { name: "Place units" }).click();
  await status(place, /Offer \d+ made/);
  await client.goto("/onboard/notes");
  await client.getByRole("region", { name: "Offered to you" }).getByRole("button", { name: "Accept with MetaMask" }).click();
  const held = client.getByRole("region", { name: "Held" }).getByRole("row").filter({ hasText: "EURWAN3" });
  await expect(held.getByRole("cell").nth(1)).toHaveText("2", { timeout: 60_000 });

  // S-11, arranged by the bank: the custody account sells one, its unit locked; the wallet buys.
  await staff.goto(notePage);
  await staff.getByText("Arrange a transfer…").click();
  const arrange = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Arrange" }) });
  await pick(arrange.locator('select[name="seller"]'), SECOND);
  await pick(arrange.locator('select[name="buyer"]'), wallet.slice(0, 10));
  await arrange.getByLabel("Price a unit (€)").fill("900.00");
  await arrange.getByRole("button", { name: "Arrange" }).click();
  await status(arrange, /Offer \d+ made/);
  await client.reload();
  const toMe = client.getByRole("region", { name: "Offered to you" });
  await expect(toMe).toContainText("buy 1 unit for €900.00");
  await expect(toMe).toContainText("a client of the bank");
  await toMe.getByRole("button", { name: "Buy with MetaMask" }).click();
  await expect(held.getByRole("cell").nth(1)).toHaveText("3", { timeout: 60_000 });

  // An open offer from the wallet, locked in it until the custody account takes it.
  await client.getByText("Make an offer on EURWAN3…").click();
  const post = client.getByRole("form", { name: "Make an offer on EURWAN3" });
  await post.getByLabel("Price a unit (€)").fill("1050.00");
  await post.getByRole("button", { name: "Make the offer with MetaMask" }).click();
  await expect(held.getByRole("cell").nth(2)).toHaveText("1", { timeout: 60_000 });
  await expect(client.getByRole("region", { name: "Your offers" })).toContainText("sell 1 unit for €1,050.00");
  await staff.goto(notePage);
  const open = staff.locator('[aria-label="Offers"] tbody tr').filter({ hasText: "Transfer, open" });
  await pick(open.locator('select[name="admission"]'), SECOND);
  await open.getByRole("button", { name: "Take for the account" }).click();
  await expect(staff.locator('[aria-label="Offers"] tbody tr').filter({ hasText: "€1,050.00" }).locator(".pill")).toHaveText("settled", { timeout: 60_000 });
  await client.reload();
  await expect(held.getByRole("cell").nth(1)).toHaveText("2");
  await expect(held.getByRole("cell").nth(2)).toHaveText("0");

  // S-12 and S-09 in the arrangement form: a buyer the onboarding agent has not vouched for (the
  // third-party custodian's account of spec 04) is refused before anything is sent.
  await staff.getByText("Arrange a transfer…").click();
  await pick(arrange.locator('select[name="seller"]'), SECOND);
  await pick(arrange.locator('select[name="buyer"]'), "not eligible for the notes");
  await arrange.getByRole("button", { name: "Arrange" }).click();
  await expect(arrange.getByRole("alert")).toContainText("buyer is not eligible for the note");

  // S-13: the Issuer buys a unit back from the wallet; it returns to the inventory.
  const facts = staff.locator(".facts").first();
  const before = Number((await facts.innerText()).match(/(\d+) of \d+ units in the Issuer's inventory/)![1]);
  await staff.getByText("Buy back units…").click();
  const buyback = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Offer to buy back" }) });
  await pick(buyback.locator('select[name="admission"]'), wallet.slice(0, 10));
  await buyback.getByRole("button", { name: "Offer to buy back" }).click();
  await status(buyback, /Offer \d+ made/);
  await client.reload();
  await client.getByRole("region", { name: "Offered to you" }).getByRole("button", { name: "Sell with MetaMask" }).click();
  await expect(held.getByRole("cell").nth(1)).toHaveText("1", { timeout: 60_000 });
  await staff.goto(notePage);
  await expect(facts).toContainText(`${before + 1} of 10 units in the Issuer's inventory`);

  // S-14: no more can be cancelled than the inventory holds; one unit can.
  await staff.getByText("Cancel units from the inventory…").click();
  const cancel = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Cancel units" }) });
  await cancel.getByLabel("Units").fill(String(before + 2));
  await cancel.getByRole("button", { name: "Cancel units" }).click();
  await expect(cancel.getByRole("alert")).toContainText("cannot be cancelled (S-14)");
  await cancel.getByLabel("Units").fill("1");
  await cancel.getByRole("button", { name: "Cancel units" }).click();
  await status(cancel, "Cancelled 1 units");
  await staff.reload();
  await expect(facts).toContainText(`${before} of 9 units in the Issuer's inventory`);

  await expectHealthy(client);
  await expectHealthy(staff);
});
