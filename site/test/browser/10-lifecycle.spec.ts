import { test, expect, expectHealthy, signedIn, warpTo, PEOPLE } from "./fixtures.ts";

test("staff determine a note's first date from the scenario's Levels, the model agrees, and the servicing wallet pays the coupon and the early redemption", async ({ browser }) => {
  test.setTimeout(240_000);
  // The note of spec 08 (early redemption on date 1), placed in spec 09 with a wallet since unbound.
  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/operator/notes");
  await staff.getByRole("link", { name: /Series 2/ }).click();
  const first = staff.getByRole("listitem", { name: "Date 1" });
  await expect(first).toContainText("Determinable from");
  await expect(first.getByRole("button", { name: "Determine date 1" })).toHaveCount(0);

  // The date comes: the Levels are the scenario's, pre-filled.
  await warpTo(Number(await first.getAttribute("data-date")));
  await staff.reload();
  await expect(first.getByLabel(/Underlying 1 Level/)).toHaveValue("473760");
  await first.getByRole("button", { name: "Determine date 1" }).click();
  await expect(first).toContainText("Agrees with the payoff model.", { timeout: 30_000 });
  await expect(first).toContainText("coupon €25.00 a unit; early redemption at €1,000.00 a unit");
  // The dates after an early redemption fall away.
  for (const k of [2, 3, 4]) await expect(staff.getByRole("listitem", { name: `Date ${k}` })).toContainText("Falls away");
  await expect(first).toContainText("Payable from");

  // Paid by the servicing wallet after the payment date; the unbound wallet is held for (E3).
  await warpTo(Number(await first.getAttribute("data-payment")));
  await staff.reload();
  await first.getByRole("button", { name: "Pay the coupon" }).click();
  const coupon = first.locator(".event").filter({ hasText: "Coupon" });
  await expect(coupon).toContainText("Paid to 2 units; closed.", { timeout: 60_000 });
  await expect(coupon.getByRole("row").filter({ hasText: "€50.00 (held)" })).toBeVisible();
  await expect(coupon.getByRole("button", { name: "Pay what is held" })).toBeVisible();

  await first.getByRole("button", { name: "Pay the redemption" }).click();
  const redemption = first.locator(".event").filter({ hasText: "Redemption" });
  await expect(redemption).toContainText("Paid to 2 units; closed.", { timeout: 60_000 });
  await expect(staff.locator(".facts")).toContainText("Redeemed and closed");

  // A held amount waits for the holder's grant: asking now says why it cannot be paid.
  await coupon.getByRole("button", { name: "Pay what is held" }).click();
  await expect(coupon.getByRole("alert")).toContainText("cannot yet receive the deposit");

  // S-33: the close-out statement does not claim zero while money is held for the unbound wallet.
  await staff.reload();
  const closeOut = staff.getByRole("region", { name: "Close-out" });
  await expect(closeOut.getByRole("status")).toContainText("Not closed: 2 check(s) fail");
  const checks = closeOut.getByRole("list", { name: "Close-out checks" });
  await expect(checks.getByRole("listitem").filter({ hasText: "Supply is zero" })).toContainText("✓");
  await expect(checks.getByRole("listitem").filter({ hasText: "Nothing is held for a holder" })).toContainText("✗");
  await expect(checks.getByRole("listitem").filter({ hasText: "The Paying Agent holds no cash" })).toContainText("✗");
  // The same statement, downloaded for the evidence pack.
  const json = await (await staff.request.get(staff.url() + "/close-out")).json();
  expect(json.closed).toBe(false);
  expect(json.totals.heldCents).toBe("205000"); // €50 of coupon and €2,000 of redemption, held
  expect(json.positions.every((p: { balance: string }) => p.balance === "0")).toBe(true);

  await staff.getByRole("link", { name: "← Notes" }).click();
  await expect(staff.locator("tbody tr").filter({ hasText: "EURWAN2" }).locator(".pill")).toHaveText("redeemed");
  await expectHealthy(staff);
});
