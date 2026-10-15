import { test, expect, expectHealthy, signedIn, warpTo, PEOPLE } from "./fixtures.ts";

test("governance: Tier 1 corrects the register, recovers a lost wallet and freezes an account, each with its reason; the Agent alone cannot force a transfer; Tier 2 needs two institutions and the delay", async ({ browser }) => {
  test.setTimeout(240_000);
  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/agent");
  await staff.getByRole("navigation", { name: "The Agent" }).getByRole("link", { name: "Tier 1" }).click();
  await expect(staff).toHaveURL(/\/agent\/governance\/tier-1$/);

  // S-25: a register correction, at once, its written reason recorded on-chain.
  await staff.getByText("Correct the register…").click();
  const correct = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Correct the register" }) });
  await correct.locator('select[name="from"]').selectOption({ label: (await correct.locator('select[name="from"] option', { hasText: "investorA" }).innerText()).trim() });
  await correct.locator('select[name="to"]').selectOption({ label: "investorB" });
  await correct.getByLabel("Written reason").fill("Browser test: lost key reported, one unit restored");
  await correct.getByRole("button", { name: "Correct the register" }).click();
  await expect(correct.getByRole("status").filter({ hasText: "Corrected: 1 unit moved" })).toBeVisible({ timeout: 60_000 });
  await staff.reload();
  await expect(staff.getByRole("table").filter({ hasText: "Written reason" }).getByRole("row").filter({ hasText: "lost key reported" }).first()).toContainText("correctRegister");

  // S-25 by ERC-3643's own recovery: a holder's units, and its identity, move to its new wallet.
  await staff.getByText("Recover a lost wallet…").click();
  const recover = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Recover the units" }) });
  const lost = recover.locator('select[name="lost"] option', { hasText: "investorB" });
  await recover.locator('select[name="lost"]').selectOption((await lost.getAttribute("value"))!);
  await recover.locator('input[name="replacement"]').fill("0x00000000000000000000000000000000000b0b0b");
  await recover.getByLabel("Written reason").fill("Browser test: investor B reported its key lost");
  await recover.getByRole("button", { name: "Recover the units" }).click();
  await expect(recover.getByRole("status").filter({ hasText: "Recovered: the units and the identity are on the new wallet" })).toBeVisible({ timeout: 60_000 });

  // The supervisory stop: frozen at once, whichever institution vouched for the account, then lifted.
  await staff.getByText(/^Freeze an account/).click();
  const stop = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Act", exact: true }) });
  const account = (await stop.locator('select[name="account"] option', { hasText: "investorA" }).getAttribute("value"))!;
  await stop.locator('select[name="what"]').selectOption("freeze");
  await stop.locator('select[name="account"]').selectOption(account);
  await stop.getByLabel("Written reason").fill("Browser test: sanctions screening hit under review");
  await stop.getByRole("button", { name: "Act", exact: true }).click();
  await expect(stop.getByRole("status").filter({ hasText: "Frozen: the account can neither send nor receive the note." })).toBeVisible({ timeout: 60_000 });
  // The form clears once it has acted, so the account is chosen again.
  await stop.locator('select[name="what"]').selectOption("unfreeze");
  await stop.locator('select[name="account"]').selectOption(account);
  await stop.getByLabel("Written reason").fill("Browser test: screening cleared");
  await stop.getByRole("button", { name: "Act", exact: true }).click();
  await expect(stop.getByRole("status").filter({ hasText: "Unfrozen." })).toBeVisible({ timeout: 60_000 });
  await staff.reload();
  const reasons = staff.getByRole("table").filter({ hasText: "Written reason" });
  await expect(reasons.getByRole("row").filter({ hasText: "investor B reported its key lost" }).first()).toContainText("recoverWallet");
  await expect(reasons.getByRole("row").filter({ hasText: "screening cleared" }).first()).toContainText("unfreezeAccount");

  // S-26: the Agent's servicing wallet forcing a transfer directly is refused.
  await staff.getByText("Outside the control framework (S-26)…").click();
  const attempt = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Attempt a forced transfer as the Agent" }) });
  await attempt.getByRole("button", { name: "Attempt a forced transfer as the Agent" }).click();
  await expect(attempt.getByRole("status")).toContainText("Only the governance controller may force a transfer (S-26)", { timeout: 30_000 });

  // Tier 2: the Issuer proposes; alone it cannot queue (S-22); with the co-signer it queues; after the delay it executes.
  await staff.getByRole("navigation", { name: "The Agent" }).getByRole("link", { name: "Tier 2" }).click();
  await expect(staff.locator(".facts")).toContainText("At least 2 institutions, whose wallets need 4 signatures between them");
  await expect(staff.locator(".facts")).toContainText("1 day after the delay");
  await staff.getByText("Propose…").click();
  const propose = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Propose" }) });
  await expect(propose.locator('select[name="kind"] option', { hasText: "Replace the Agent's servicing wallet" })).toHaveAttribute("disabled", "");
  await propose.getByLabel("Notional: units").fill("3");
  await propose.getByLabel("Written reason").fill("Browser test: tranche up by three units");
  await propose.getByRole("button", { name: "Propose" }).click();
  await expect(propose.getByRole("status")).toContainText(/Proposed as proposal \d+/, { timeout: 60_000 });
  const id = (await propose.getByRole("status").innerText()).match(/proposal (\d+)/)![1];

  await staff.reload();
  const card = staff.getByRole("listitem", { name: `Proposal ${id}` });
  await expect(card.locator(".pill")).toHaveText("awaiting approvals");
  await expect(card).toContainText("1 institution approve, with 2 signatures");
  await card.getByRole("button", { name: "Execute" }).click();
  await expect(card.getByRole("alert")).toContainText("Not queued: the thresholds are not met yet (S-22)");

  await card.getByRole("button", { name: "Approve as the Co-signing institution" }).click();
  await expect(card.locator(".pill")).toHaveText("queued", { timeout: 60_000 });
  await expect(card).toContainText("2 institutions approve, with 4 signatures");
  await card.getByRole("button", { name: "Execute" }).click();
  await expect(card.getByRole("alert")).toContainText("Not ready: executable from");

  // The delay runs (an hour on the local stack): the chain's clock is moved, not waited for.
  const readyAt = Date.parse((await card.innerText()).match(/Executable from (\d{4}-\d\d-\d\d \d\d:\d\d) UTC/)![1].replace(" ", "T") + ":00Z") / 1000;
  await warpTo(readyAt + 60);
  await staff.reload();
  await expect(card.locator(".pill")).toHaveText("executable");
  await card.getByRole("button", { name: "Execute" }).click();
  await expect(card.locator(".pill")).toHaveText("executed", { timeout: 60_000 });
  await expectHealthy(staff);
});
