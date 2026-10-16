import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";
import { STORE_DIR } from "./people.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");

test("with no client on the bank's records, a request asks for one to be added rather than offering to confirm", async ({ browser }) => {
  const path = join(STORE_DIR, "store.json");
  const before = readFileSync(path, "utf8");
  const m = JSON.parse(readFileSync(join(REPO, "ops", "addresses.json"), "utf8"));
  const store = JSON.parse(before);
  store.clients = [];
  store.admissions = [
    ...(store.admissions ?? []),
    {
      id: "adm_no_client_yet", registrantId: PEOPLE.custodied.id, route: "bank-custody", status: "requested", createdAt: new Date().toISOString(),
      officerRequestId: null, walletRequestId: null,
      data: { request: { organisation: "Fresh Start SA", requestedBy: PEOPLE.custodied.email }, deployment: `${m.chainId}:${m.identity.identityStorage.toLowerCase()}` },
    },
  ];
  writeFileSync(path, JSON.stringify(store));
  try {
    const bank = await signedIn(browser, PEOPLE.banker);
    await bank.goto("/bank/onboarding");
    const panel = bank.locator("section.panel").filter({ hasText: "Fresh Start SA" });
    await expect(panel.getByRole("button", { name: "Confirm the client's KYB" })).toHaveCount(0);
    await expect(panel).toContainText("The bank has no client yet.");
    await panel.getByRole("link", { name: "Add the client under Clients" }).click();
    await expect(bank).toHaveURL(/\/bank\/clients$/);
    await expectHealthy(bank);
  } finally {
    writeFileSync(path, before);
  }
});
