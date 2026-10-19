import { keccak256, toBytes } from "viem";
import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";

test("reconciliation: every note the factory issued, its statement now and as at the close of a day, downloaded as JSON and CSV, and the term sheet it was issued from", async ({ browser }) => {
  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/agent");
  await staff.getByRole("navigation", { name: "The Agent" }).getByRole("link", { name: "Reconciliation" }).click();
  await expect(staff).toHaveURL(/\/agent\/reconciliation$/);

  // The deployment's note under review, and the notes issued here, each from the factory's record.
  const rows = staff.locator("tbody tr");
  await expect(rows.filter({ hasText: "under review" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "EURWAN2" })).toHaveCount(1);
  await rows.filter({ hasText: "under review" }).getByRole("link", { name: "Statement" }).click();
  await expect(staff).toHaveURL(/\/agent\/reconciliation\/0x[0-9a-fA-F]{40}$/);

  // Now: the note under review reconciles, every check passing.
  const statement = staff.getByRole("region", { name: "Reconciliation" });
  await expect(statement.getByRole("status")).toContainText("Reconciled: every check passes, as at now");
  await expect(statement.getByRole("table", { name: "Positions" })).toContainText("Investor A");

  // As at the close of a day: the newest day listed, read at its last block.
  const days = staff.getByRole("table", { name: "Statements by day" });
  const day = (await days.locator("tbody tr").first().locator("td").first().innerText()).trim();
  await days.getByRole("link", { name: day }).click();
  await expect(staff).toHaveURL(new RegExp(`asAt=${day}$`));
  await expect(statement.getByRole("status")).toContainText(`as at the close of ${day} (UTC)`);

  // Downloads: the JSON with every figure, the CSV with every position.
  const json = await (await staff.request.get(new URL((await statement.getByRole("link", { name: "JSON" }).getAttribute("href"))!, staff.url()).toString())).json();
  expect(json.note.symbol).toBe("EURWAN");
  expect(json.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
  const csv = await (await staff.request.get(new URL((await statement.getByRole("link", { name: "CSV" }).getAttribute("href"))!, staff.url()).toString())).text();
  const lines = csv.trim().split("\n");
  expect(lines[0]).toBe("note,block,as_at,account,name,units_in,units_out,balance,locked_units,eligible,coupons_eur,redemption_eur,held_eur");
  expect(lines.length).toBe(json.positions.length + 1);

  // The term sheet the note was issued from, field by field, and as published at its hash.
  const sheet = staff.getByRole("region", { name: "Term sheet" });
  await expect(sheet).toContainText("not applicable: Not listed");
  await expect(sheet.getByRole("table", { name: "Observation calendar" }).locator("tbody tr")).toHaveCount(4);
  await expect(statement.getByRole("list", { name: "Reconciliation checks" }).getByRole("listitem").filter({ hasText: "The term sheet matches the note" })).toContainText("✓");
  const published = await staff.request.get(new URL((await sheet.getByRole("link", { name: "The record as published (JSON)" }).getAttribute("href"))!, staff.url()).toString());
  const body = await published.text();
  expect(keccak256(toBytes(body))).toBe(json.termSheet.hash);
  const anonymous = await (await browser.newContext()).request.get(new URL(`/term-sheets/${json.termSheet.hash}`, staff.url()).toString());
  expect(anonymous.status(), "behind sign-in").toBe(401);

  // Not the bank's: the statement is the Agent's.
  const bank = await signedIn(browser, PEOPLE.banker);
  expect((await bank.request.get(new URL((await statement.getByRole("link", { name: "CSV" }).getAttribute("href"))!, staff.url()).toString())).status()).toBe(404);
  await expectHealthy(staff);
});
