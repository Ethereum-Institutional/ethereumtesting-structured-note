import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";
import { STANDINS_PORT } from "./people.ts";

test("an operator approves one registration and declines another", async ({ browser }) => {
  const page = await signedIn(browser, PEOPLE.operator);
  await page.goto("/operator");
  const applicant = page.getByRole("row").filter({ hasText: PEOPLE.applicant.email });
  await applicant.getByRole("button", { name: "Approve" }).click();
  await expect(applicant.locator(".pill")).toHaveText("approved");

  const declined = page.getByRole("row").filter({ hasText: PEOPLE.declined.email });
  await declined.getByRole("button", { name: "Decline" }).click();
  await expect(declined.locator(".pill")).toHaveText("revoked");

  // A registration that has not confirmed its address (ADR 0077): the page says so, and staff can
  // send a fresh link, or approve ahead of the confirmation.
  const unconfirmed = page.getByRole("row").filter({ hasText: PEOPLE.unconfirmed.email });
  await expect(unconfirmed).toContainText("Hasn't confirmed their email yet");
  await unconfirmed.getByRole("button", { name: "Resend link" }).click();
  await expect(unconfirmed.getByRole("status")).toHaveText(`Sent a fresh link to ${PEOPLE.unconfirmed.email}.`);
  const mails = await (await fetch(`http://127.0.0.1:${STANDINS_PORT}/test/mails`)).json();
  expect(mails.at(-1)).toMatchObject({ to: PEOPLE.unconfirmed.email, subject: "Confirm your email address" });
  expect(mails.at(-1).text).toContain("/access?token=");
  // Again at once: throttled, and said so.
  await unconfirmed.getByRole("button", { name: "Resend link" }).click();
  await expect(unconfirmed.getByRole("alert")).toContainText("try again shortly");
  await unconfirmed.getByRole("button", { name: "Approve" }).click();
  await expect(unconfirmed.locator(".pill")).toHaveText("approved");
  await expectHealthy(page);
});
