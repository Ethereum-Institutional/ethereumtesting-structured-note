import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";
import { STORE_DIR } from "./people.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");

/** A note whose step is in flight, as one left when the request running it was stopped on Ethereum Sepolia. */
function stuckNote(id: string) {
  const m = JSON.parse(readFileSync(join(REPO, "ops", "addresses.json"), "utf8"));
  const path = join(STORE_DIR, "store.json");
  const store = JSON.parse(readFileSync(path, "utf8"));
  store.notes = [
    ...(store.notes ?? []),
    {
      id, name: "Stuck Note, Series 9", symbol: "STUCK9", scenario: "mer-at-trigger", observations: 4, interval: { value: 1, unit: "hours" },
      units: 3, status: "issuing", step: -1, claimedAt: new Date().toISOString(), createdAt: new Date().toISOString(), by: PEOPLE.operator.email,
      addresses: {}, txs: {}, data: { deployment: `${m.chainId}:${m.identity.identityStorage.toLowerCase()}` },
    },
  ];
  writeFileSync(path, JSON.stringify(store));
}

test("an issuance whose step is in flight is left to finish, not marked issued; staff can stop one that will not (ADR 0105)", async ({ browser }) => {
  stuckNote("note_stuck_browser");
  const page = await signedIn(browser, PEOPLE.operator);
  await page.goto("/agent/notes");
  const row = page.getByRole("row").filter({ hasText: "Stuck Note, Series 9" });
  await expect(row.locator(".pill")).toHaveText("issuing");
  await expect(row).toContainText("Step 1 of 4");
  // The page polls every few seconds: the step in flight stays in flight.
  await page.waitForTimeout(7_000);
  await expect(row.locator(".pill")).toHaveText("issuing");

  await row.getByText("Stop issuing…").click();
  await row.getByRole("button", { name: "Stop" }).click();
  // The row re-renders as stopped, its Stop control gone with it.
  const stopped = page.getByRole("row").filter({ hasText: "Stuck Note, Series 9" });
  await expect(stopped.locator(".pill")).toHaveText("failed");
  await expect(stopped).toContainText(`Stopped by ${PEOPLE.operator.email} at step 1`);
  await expect(stopped.getByText("Stop issuing…")).toHaveCount(0);
  await expectHealthy(page);
});
