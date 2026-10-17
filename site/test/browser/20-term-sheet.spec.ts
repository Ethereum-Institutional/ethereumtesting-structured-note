import { createPublicClient, http } from "viem";
import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";
import { termSheetFrom, v } from "../../lib/notes/termsheet.ts";

test("staff issue a note from the term sheet they upload: a wrong one is refused with its reason, a right one is issued with its ISIN, and the book shows it", async ({ browser }) => {
  test.setTimeout(180_000);
  const chain = createPublicClient({ transport: http(process.env.RPC_URL ?? "http://127.0.0.1:8545") });
  const now = Number((await chain.getBlock()).timestamp);
  const day = 86_400;
  const record = termSheetFrom({
    name: "EUR Worst-of Autocallable Note, uploaded",
    symbol: "EURUP1",
    chainId: await chain.getChainId(),
    issueSizeUnits: 8,
    strikeTime: now,
    initialLevels: [451200, 1820300, 25000],
    calculationAmountCents: 100000,
    couponBarrierBps: 7000,
    couponRateBps: 250,
    memory: false,
    barrierBps: 6000,
    twinWin: { applies: false, upBps: 0, downBps: 0, capBps: 0 },
    schedule: [1, 2].map((k) => ({ date: now + k * day, recordTime: now + k * day + 3600, paymentDate: now + k * day + 7200, coupon: true, mer: k === 1, barrier: k === 2, isFinal: k === 2, merTriggerBps: k === 1 ? 10000 : 0 })),
    depositSymbol: "EURTD",
  });

  const staff = await signedIn(browser, PEOPLE.operator);
  await staff.goto("/agent/notes");
  const form = staff.locator("form").filter({ has: staff.getByRole("button", { name: "Issue from the term sheet" }) });

  // A wrong check digit is refused, with the reason, before anything is sent.
  record.fields.isin = v("XS0000001238");
  await form.getByLabel("Term sheet file").setInputFiles({ name: "term-sheet.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) });
  await form.getByRole("button", { name: "Issue from the term sheet" }).click();
  await expect(form.getByRole("alert")).toContainText("check digit");

  record.fields.isin = v("XS0000001247");
  await form.getByLabel("Term sheet file").setInputFiles({ name: "term-sheet.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) });
  await form.getByRole("button", { name: "Issue from the term sheet" }).click();
  await expect(form.getByRole("status")).toContainText("Issuing EUR Worst-of Autocallable Note, uploaded (EURUP1) from its term sheet");

  const row = staff.locator("#notes + .panel tbody tr").filter({ hasText: "EURUP1" });
  await expect(row).toContainText("Issued from its term sheet");
  await expect(row.locator(".pill")).toHaveText("issued", { timeout: 120_000 });
  await expect(row).toContainText("XS0000001247");

  await staff.getByRole("navigation", { name: "The Agent" }).getByRole("link", { name: "Book" }).click();
  const booked = staff.getByRole("row", { name: "EURUP1", exact: true });
  await expect(booked).toContainText("XS0000001247");
  await expect(booked).toContainText("8 outstanding");
  await expect(booked).toContainText("0 of 2 determined");
  await expectHealthy(staff);
});
