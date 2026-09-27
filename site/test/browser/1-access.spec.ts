import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";

test("an operator approves one registration and declines another", async ({ browser }) => {
  const page = await signedIn(browser, PEOPLE.operator);
  await page.goto("/operator");
  const applicant = page.getByRole("row").filter({ hasText: PEOPLE.applicant.email });
  await applicant.getByRole("button", { name: "Approve" }).click();
  await expect(applicant.locator(".pill")).toHaveText("approved");

  const declined = page.getByRole("row").filter({ hasText: PEOPLE.declined.email });
  await declined.getByRole("button", { name: "Decline" }).click();
  await expect(declined.locator(".pill")).toHaveText("revoked");
  await expectHealthy(page);
});
