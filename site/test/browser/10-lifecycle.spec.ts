import { test, expect, expectHealthy, signedIn, warpTo, PEOPLE } from "./fixtures.ts";

test("staff determine a note's first date from the scenario's Levels, the model agrees, and the servicing wallet pays the coupon and the early redemption", async ({ browser }) => {
  test.setTimeout(240_000);
  // The note of spec 08 (early redemption on date 1), placed in spec 09 with the self-custody wallet.
  const staff = await signedIn(browser, PEOPLE.operator);

  /** The bank revokes or renews its claim on the self-custody wallet, from its Onboarding page. */
  async function bankClaim(act: "Revoke" | "Renew") {
    const bank = await signedIn(browser, PEOPLE.banker);
    await bank.goto("/bank/onboarding");
    const row = bank.locator("#onboarded + .table-wrap tbody tr").filter({ hasText: "Self-custody" }).first();
    await row.getByText(`${act} the bank's claim…`).click();
    if (act === "Revoke") await row.getByLabel("Reason").first().fill("Screening hit under review");
    await row.getByRole("button", { name: act, exact: true }).click();
    await expect(row.getByRole("status")).toContainText(act === "Revoke" ? "can no longer hold" : "Renewed", { timeout: 30_000 });
    await bank.close();
    await new Promise((r) => setTimeout(r, 1_600)); // past the lagging RPC's window
  }
  await staff.goto("/agent/notes");
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

  // Paid by the servicing wallet after the payment date; a wallet the deposit cannot credit, its
  // bank's claim revoked, is held for (E3).
  await bankClaim("Revoke");
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
  await expect(staff.locator("dl.facts:not([aria-label])")).toContainText("Redeemed and closed");

  // A held amount waits for the bank's claim: asking now says why it cannot be paid.
  await coupon.getByRole("button", { name: "Pay what is held" }).click();
  await expect(coupon.getByRole("alert")).toContainText("cannot yet receive the deposit");

  // S-33: the statement does not claim zero while money is held for the wallet (ADR 0094).
  await staff.reload();
  const statement = staff.getByRole("region", { name: "Reconciliation" });
  await expect(statement.getByRole("status")).toContainText("Redeemed, not closed: 2 check(s) fail");
  const checks = statement.getByRole("list", { name: "Reconciliation checks" });
  await expect(checks.getByRole("listitem").filter({ hasText: "Supply is zero" })).toContainText("✓");
  await expect(checks.getByRole("listitem").filter({ hasText: "Nothing is held for a holder" })).toContainText("✗");
  await expect(checks.getByRole("listitem").filter({ hasText: "The Paying Agent holds no cash" })).toContainText("✗");
  await expect(checks.getByRole("listitem").filter({ hasText: "The Paying Agent holds what it owes" })).toContainText("✓");
  // The same statement, downloaded for the evidence pack.
  const href = await statement.getByRole("link", { name: "JSON" }).getAttribute("href");
  const json = await (await staff.request.get(new URL(href!, staff.url()).toString())).json();
  expect(json.closed).toBe(false);
  expect(json.totals.heldCents).toBe("205000"); // €50 of coupon and €2,000 of redemption, held
  expect(json.positions.every((p: { balance: string }) => p.balance === "0")).toBe(true);

  // The bank vouches again; what was held is paid, and the note closes.
  await bankClaim("Renew");
  await staff.reload();
  await coupon.getByRole("button", { name: "Pay what is held" }).click();
  await expect(coupon.getByRole("row").filter({ hasText: "€50.00 (held)" })).toHaveCount(0, { timeout: 30_000 });

  await staff.getByRole("link", { name: "← Notes" }).click();
  await expect(staff.locator("tbody tr").filter({ hasText: "EURWAN2" }).locator(".pill")).toHaveText("redeemed");
  await expectHealthy(staff);
});
