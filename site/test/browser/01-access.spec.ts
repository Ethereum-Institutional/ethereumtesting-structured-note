import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";
import { MAILBOX_PORT } from "./people.ts";

test("the bank approves one sign-up and declines another; each staff member sees only its own portals", async ({ browser }) => {
  // The bank's staff see the bank's portal, and no other.
  const banker = await signedIn(browser, PEOPLE.banker);
  await banker.goto("/bank");
  await expect(banker.getByRole("heading", { name: "Sign-ups" })).toBeVisible();
  const bar = banker.locator(".bar nav");
  await expect(bar.getByRole("link", { name: "Bank" })).toBeVisible();
  for (const other of ["Onboarding agent", "Custodians", "Agent"]) await expect(bar.getByRole("link", { name: other, exact: true })).toHaveCount(0);
  for (const path of ["/agent", "/onboarding", "/custodian"]) {
    const res = await banker.goto(path);
    expect(res?.status(), `${path} is not the bank's`).toBe(404);
  }

  // The operator demonstrates every portal.
  const page = await signedIn(browser, PEOPLE.operator);
  await page.goto("/bank");
  for (const name of ["Bank", "Onboarding agent", "Custodians", "Agent"]) await expect(page.locator(".bar nav").getByRole("link", { name, exact: true })).toBeVisible();
  const applicant = page.getByRole("row").filter({ hasText: PEOPLE.applicant.email });
  await applicant.getByRole("button", { name: "Approve" }).click();
  await expect(applicant.locator(".pill")).toHaveText("approved");

  const declined = page.getByRole("row").filter({ hasText: PEOPLE.declined.email });
  await declined.getByRole("button", { name: "Decline" }).click();
  await expect(declined.locator(".pill")).toHaveText("revoked");

  // A registration that has not confirmed its address: the page says so, and staff can
  // send a fresh code, or approve ahead of the confirmation.
  const unconfirmed = page.getByRole("row").filter({ hasText: PEOPLE.unconfirmed.email });
  await expect(unconfirmed).toContainText("Hasn't confirmed their email yet");
  await unconfirmed.getByRole("button", { name: "Resend code" }).click();
  await expect(unconfirmed.getByRole("status")).toHaveText(`Sent a fresh code to ${PEOPLE.unconfirmed.email}.`);
  const mails = await (await fetch(`http://127.0.0.1:${MAILBOX_PORT}/test/mails`)).json();
  expect(mails.at(-1)).toMatchObject({ to: PEOPLE.unconfirmed.email, subject: "Your code to confirm your email address" });
  expect(mails.at(-1).text).toMatch(/\b\d{6}\b/);
  // The mail links to the page that takes the code, and the link carries the address, not the code.
  const sentCode = mails.at(-1).text.match(/\b(\d{6})\b/)[1];
  const codeLink = mails.at(-1).text.match(/https?:\/\/\S+/)[0];
  expect(codeLink).toContain(`/access?email=${encodeURIComponent(PEOPLE.unconfirmed.email)}`);
  expect(codeLink).not.toContain(sentCode);
  // Again at once: throttled, and said so.
  await unconfirmed.getByRole("button", { name: "Resend code" }).click();
  await expect(unconfirmed.getByRole("alert")).toContainText("try again shortly");
  await unconfirmed.getByRole("button", { name: "Approve" }).click();
  await expect(unconfirmed.locator(".pill")).toHaveText("approved");

  // Deletion is the admin's alone: the bank's own staff are not offered it; the operator,
  // in OPERATOR_EMAILS, deletes the declined sign-up, and the address may register again.
  await banker.goto("/bank");
  await expect(banker.getByText("Delete…")).toHaveCount(0);
  await page.goto("/bank");
  const gone = page.getByRole("row").filter({ hasText: PEOPLE.declined.email });
  await gone.getByText("Delete…").click();
  await gone.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByRole("row").filter({ hasText: PEOPLE.declined.email })).toHaveCount(0);
  await page.goto("/agent/audit");
  await expect(page.getByRole("row").filter({ hasText: "deleted the registration" }).filter({ hasText: PEOPLE.declined.email })).toHaveCount(1);
  await expectHealthy(page);
});
