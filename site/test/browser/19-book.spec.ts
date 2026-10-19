import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";

test("the book: every note on one page, with what each needs next, and each opening on its own page", async ({ browser }) => {
  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/agent");
  await staff.getByRole("navigation", { name: "The Agent" }).getByRole("link", { name: "Book" }).click();
  await expect(staff).toHaveURL(/\/agent\/book$/);

  const glance = staff.getByRole("list", { name: "The book at a glance" }).or(staff.locator('dl[aria-label="The book at a glance"]'));
  await expect(glance).toContainText("Notes");
  await expect(glance).toContainText("Awaiting a second approver");

  // The deployment's own note, series 1, and the note spec 08 issued and spec 10 redeemed.
  const own = staff.getByRole("row", { name: "EURWAN", exact: true });
  await expect(own).toContainText("1");
  await expect(own.locator(".pill")).toHaveText("live");
  const second = staff.getByRole("row", { name: "EURWAN2", exact: true });
  await expect(second).toContainText("XS0000001239");
  await expect(second.locator(".pill")).toHaveText("closed");
  await expect(second).toContainText("Redeemed and closed");

  await second.getByRole("link", { name: "EURWAN2" }).click();
  await expect(staff).toHaveURL(/\/agent\/notes\/note_/);

  // Every view covers every note: participants and the register show each account's units of all of them.
  await staff.goto("/agent");
  await expect(staff.getByRole("columnheader", { name: "Holds" })).toBeVisible();
  await staff.goto("/ledger");
  const register = staff.getByRole("table").filter({ has: staff.getByRole("columnheader", { name: "Units of the notes" }) });
  await expect(register).toBeVisible();
  await expect(register.getByRole("cell", { name: /\d+ EURWAN\b/ }).first()).toBeVisible();
  await expectHealthy(staff);
});
