import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";

test("an account holding the note cannot be closed; a client with an account on the chain cannot be removed; one without is removed, to be added again (ADRs 0107, 0108)", async ({ browser }) => {
  // The self-custody client of spec 03 holds units since spec 09: its request is refused, naming them.
  const client = await signedIn(browser, PEOPLE.selfCustody);
  await client.goto("/onboard");
  const account = client.getByRole("region", { name: "Self-custody" });
  await account.getByText("Close this account…").click();
  await account.getByLabel("Reason").fill("Moving banks");
  await account.getByRole("button", { name: "Ask to close" }).click();
  await expect(account.getByRole("alert")).toContainText("cannot close while it holds or is owed anything", { timeout: 60_000 });
  await expect(account.getByRole("alert")).toContainText("units of");

  // Its client is on the chain through that account: its record stays.
  const bank = await signedIn(browser, PEOPLE.banker);
  await bank.goto("/bank/clients");
  const onChain = bank.locator("#clients + .panel tbody tr").filter({ hasText: "Browser Test Institution SA" });
  await onChain.getByText("Remove…").click();
  await onChain.getByLabel("Reason").fill("Wrong jurisdiction");
  await onChain.getByRole("button", { name: "Remove the client" }).click();
  await expect(onChain.getByRole("alert")).toContainText("onboarded on the chain");

  // A client with nothing on the chain is removed, to be added again with its facts put right.
  const form = bank.locator("form").filter({ has: bank.getByLabel("Registration number") });
  await form.getByLabel("Legal name").fill("Misspelt Holdings SA");
  await form.getByLabel("Legal form").selectOption("PLC");
  await form.getByLabel("Registration number").fill("B 123 456");
  await form.getByLabel("Jurisdiction").selectOption("LU");
  await form.getByLabel("Incorporation date").fill("2010-01-02");
  await form.getByRole("button", { name: "Add client" }).click();
  await expect(form.getByRole("status")).toContainText("Added Misspelt Holdings SA as CLI-");
  const row = bank.locator("#clients + .panel tbody tr").filter({ hasText: "Misspelt Holdings SA" });
  await row.getByText("Remove…").click();
  await row.getByLabel("Reason").fill("Legal name misspelt");
  await row.getByRole("button", { name: "Remove the client" }).click();
  await expect(bank.locator("#clients + .panel tbody tr").filter({ hasText: "Misspelt Holdings SA" })).toHaveCount(0);
  await expectHealthy(client);
  await expectHealthy(bank);
});
