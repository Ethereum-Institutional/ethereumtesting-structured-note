import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";

test("staff issue a note; the page carries the issuance to the end, and the Ledger names its contracts", async ({ browser }) => {
  test.setTimeout(180_000); // issuance is two transactions: the Issuer's wallet's through the note factory, and the bank's credit
  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/agent/notes");
  const form = staff.locator("#notes + .panel form").filter({ has: staff.locator('select[name="scenario"]') });
  const scenario = form.locator('select[name="scenario"]');
  const value = await scenario.locator("option", { hasText: "early redemption" }).first().getAttribute("value");
  await scenario.selectOption(value!);
  // The calendar is configured, and previewed before issuing: quarterly mirrors a real note.
  // Ten minutes to place units before the first date, however close together the dates come after it.
  await form.getByLabel("Offer period", { exact: true }).fill("10");
  await form.getByLabel("Observations (coupon dates)").fill("4");
  await form.getByLabel("Time between observations").fill("3");
  await form.getByLabel("Unit", { exact: true }).selectOption("months");
  await expect(form.getByRole("note")).toContainText("the note's whole life is about 0.8 years");
  await expect(form.getByRole("note")).toContainText("Offer period until");
  await expect(form.getByRole("note")).not.toContainText("stretched");
  await form.getByLabel("Time between observations").fill("5");
  await form.getByLabel("Unit", { exact: true }).selectOption("minutes");
  await expect(form.getByRole("note")).toContainText("about 27 minutes");
  // Issued 30 minutes apart, so no date arrives in real time during the run: spec 10 moves the
  // chain's clock to each date instead.
  await form.getByLabel("Time between observations").fill("30");
  await form.getByLabel("Units").fill("10");
  // A wrong ISIN is refused on the form, with the reason, and nothing is issued.
  await form.getByLabel("ISIN (optional)").fill("XS0000001238");
  await form.getByRole("button", { name: "Issue", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("check digit");
  await form.getByLabel("ISIN (optional)").fill("XS0000001239");
  await form.getByRole("button", { name: "Issue", exact: true }).click();

  const row = staff.locator("#notes + .panel tbody tr").filter({ hasText: "EURWAN2" });
  await expect(row).toContainText("issuing");
  await expect(row.locator(".pill")).toHaveText("issued", { timeout: 120_000 });
  await expect(row).toContainText("Date 4:");
  // Each note opens on its own page, with its contracts.
  await row.getByRole("link", { name: /Series 2/ }).click();
  await expect(staff).toHaveURL(/\/agent\/notes\/note_/);
  await expect(staff.locator(".facts").first()).toContainText("XS0000001239");
  await expect(staff.locator(".facts").first()).toContainText("as the note factory numbered it");
  await staff.getByText("Contracts").click();
  await expect(staff.locator("details").filter({ hasText: "Contracts" })).toContainText("payingAgent:");

  await staff.goto("/ledger");
  await expect(staff.getByText("Issued a note whole, in one transaction").first()).toBeVisible();
  await expect(staff.getByText("unrecognised", { exact: true })).toHaveCount(0);
  await expectHealthy(staff);
});
