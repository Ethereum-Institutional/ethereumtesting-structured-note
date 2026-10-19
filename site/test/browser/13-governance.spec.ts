import { test, expect, expectHealthy, signedIn, warpTo, PEOPLE } from "./fixtures.ts";

test("governance: one controller for every note; Tier 1 corrects the register of the note chosen, recovers a lost wallet, freezes an account and designates one under sanctions, each with its reason; the Agent alone cannot force a transfer; Tier 2 needs two institutions and the delay", async ({ browser }) => {
  test.setTimeout(240_000);
  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/agent");
  await staff.getByRole("navigation", { name: "The Agent" }).getByRole("link", { name: "Tier 1" }).click();
  await expect(staff).toHaveURL(/\/agent\/governance\/tier-1$/);

  // Every note the controller governs can be chosen; the page names the one it acts on.
  const picker = staff.getByRole("form", { name: "Choose the note" });
  const choices = await picker.locator('select[name="note"] option').allInnerTexts();
  expect(choices.length).toBeGreaterThan(1);
  expect(choices.some((c) => c.startsWith("EURWAN2:"))).toBe(true);
  await picker.locator('select[name="note"]').selectOption({ label: choices.find((c) => c.startsWith("EURWAN2:"))! });
  await picker.getByRole("button", { name: "Show" }).click();
  await expect(staff).toHaveURL(/\/agent\/governance\/tier-1\?note=0x/);
  await expect(staff.locator('dl[aria-label="The note chosen"]')).toContainText("(EURWAN2)");
  await expect(staff.locator("summary", { hasText: "Correct the register of EURWAN2" })).toBeVisible();
  // Back to the deployment's own note, where the investors hold units.
  await picker.locator('select[name="note"]').selectOption({ label: choices.find((c) => c.startsWith("EURWAN:"))! });
  await picker.getByRole("button", { name: "Show" }).click();
  await expect(staff.locator('dl[aria-label="The note chosen"]')).toContainText("(EURWAN)");

  // A register correction, at once, its written reason recorded on-chain against the note.
  await staff.locator("summary", { hasText: /^Correct the register of / }).click();
  const correct = staff.locator("form").filter({ has: staff.getByRole("button", { name: /^Correct the register of/ }) });
  await correct.locator('select[name="from"]').selectOption({ label: (await correct.locator('select[name="from"] option', { hasText: "Investor A" }).innerText()).trim() });
  await correct.locator('select[name="to"]').selectOption({ label: "Investor B" });
  await correct.getByLabel("Written reason").fill("Browser test: lost key reported, one unit restored");
  await correct.getByRole("button", { name: /^Correct the register of/ }).click();
  await expect(correct.getByRole("status").filter({ hasText: "Corrected: 1 unit moved" })).toBeVisible({ timeout: 60_000 });
  await staff.reload();
  const corrected = staff.getByRole("table").filter({ hasText: "Written reason" }).getByRole("row").filter({ hasText: "lost key reported" }).first();
  await expect(corrected).toContainText("correctRegister");
  await expect(corrected).toContainText("EURWAN");

  // ERC-3643's own recovery: a holder's units of every note, and its identity, move to its new wallet.
  await staff.getByText("Recover a lost wallet, on every note it holds…").click();
  const recover = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Recover the units" }) });
  const lost = recover.locator('select[name="lost"] option', { hasText: "Investor B" });
  await recover.locator('select[name="lost"]').selectOption((await lost.getAttribute("value"))!);
  await recover.locator('input[name="replacement"]').fill("0x00000000000000000000000000000000000b0b0b");
  await recover.getByLabel("Written reason").fill("Browser test: investor B reported its key lost");
  await recover.getByRole("button", { name: "Recover the units" }).click();
  await expect(recover.getByRole("status").filter({ hasText: "Recovered: the units of every note it held and its identity are on the new wallet" })).toBeVisible({ timeout: 60_000 });

  // The supervisory stop: frozen at once, whichever institution vouched for the account, then lifted.
  await staff.getByText(/^Freeze an account/).click();
  const stop = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Act", exact: true }) });
  const account = (await stop.locator('select[name="account"] option', { hasText: "Investor A" }).getAttribute("value"))!;
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
  // A sanctions designation stops the account on every note at once, and is lifted.
  await stop.locator('select[name="what"]').selectOption("designate");
  await stop.locator('select[name="account"]').selectOption(account);
  await stop.getByLabel("Written reason").fill("Browser test: designated on the consolidated list");
  await stop.getByRole("button", { name: "Act", exact: true }).click();
  await expect(stop.getByRole("status").filter({ hasText: "Designated: no note moves to or from the account." })).toBeVisible({ timeout: 60_000 });
  await stop.locator('select[name="what"]').selectOption("undesignate");
  await stop.locator('select[name="account"]').selectOption(account);
  await stop.getByLabel("Written reason").fill("Browser test: delisted");
  await stop.getByRole("button", { name: "Act", exact: true }).click();
  await expect(stop.getByRole("status").filter({ hasText: "The designation is lifted." })).toBeVisible({ timeout: 60_000 });
  await staff.reload();
  const reasons = staff.getByRole("table").filter({ hasText: "Written reason" });
  await expect(reasons.getByRole("row").filter({ hasText: "investor B reported its key lost" }).first()).toContainText("recoverWallet");
  await expect(reasons.getByRole("row").filter({ hasText: "screening cleared" }).first()).toContainText("unfreezeAccount");
  await expect(reasons.getByRole("row").filter({ hasText: "consolidated list" }).first()).toContainText("every note");

  // The Agent's servicing wallet forcing a transfer directly is refused.
  await staff.getByText("Outside the control framework…").click();
  const attempt = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Attempt a forced transfer as the Agent" }) });
  await attempt.getByRole("button", { name: "Attempt a forced transfer as the Agent" }).click();
  await expect(attempt.getByRole("status")).toContainText("the controller: yes", { timeout: 30_000 });

  // Tier 2: the Issuer proposes; alone it cannot queue; with the co-signer it queues; after the delay it executes.
  await staff.getByRole("navigation", { name: "The Agent" }).getByRole("link", { name: "Tier 2" }).click();
  await expect(staff.locator(".facts")).toContainText("At least 2 institutions, whose wallets need 4 signatures between them");
  await expect(staff.locator(".facts")).toContainText("1 day after the delay");
  await expect(staff.locator(".facts")).toContainText("Servicing wallet");
  await staff.getByText(/^Propose, for EURWAN/).click();
  const propose = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Propose" }) });
  await expect(propose.locator('select[name="kind"] option', { hasText: "Replace the servicing wallet, for every note" })).toHaveAttribute("disabled", "");
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
  await expect(card).toContainText("(EURWAN)");
  await expect(card.getByRole("alert")).toContainText("Not queued: not enough institutions have approved it yet");

  await card.getByRole("button", { name: "Approve as the Co-signing institution" }).click();
  await expect(card.locator(".pill")).toHaveText("queued", { timeout: 60_000 });
  await expect(card).toContainText("2 institutions approve, with 4 signatures");
  await card.getByRole("button", { name: "Execute" }).click();
  await expect(card.getByRole("alert")).toContainText("Not ready: it can be executed from");

  // The delay runs (an hour on the local stack): the chain's clock is moved, not waited for.
  const readyAt = Date.parse((await card.innerText()).match(/Executable from (\d{4}-\d\d-\d\d \d\d:\d\d) UTC/)![1].replace(" ", "T") + ":00Z") / 1000;
  await warpTo(readyAt + 60);
  await staff.reload();
  await expect(card.locator(".pill")).toHaveText("executable");
  await card.getByRole("button", { name: "Execute" }).click();
  await expect(card.locator(".pill")).toHaveText("executed", { timeout: 60_000 });
  await expectHealthy(staff);
});
