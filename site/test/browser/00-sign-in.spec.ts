import { test, expect, expectHealthy, signedIn, PEOPLE } from "./fixtures.ts";
import { MAILBOX_PORT } from "./people.ts";
import type { Browser } from "@playwright/test";

/** The six-digit code in the newest mail to `to` with `subject`, once it has arrived. */
async function codeFor(to: string, subject: string): Promise<string> {
  let code = "";
  await expect(async () => {
    const mails: Array<{ to: string; subject: string; text: string }> = await (await fetch(`http://127.0.0.1:${MAILBOX_PORT}/test/mails`)).json();
    const mail = mails.filter((m) => m.to === to && m.subject === subject).at(-1);
    expect(mail, `a mail to ${to}`).toBeTruthy();
    code = mail!.text.match(/\b(\d{6})\b/)![1];
  }).toPass({ timeout: 10_000 });
  return code;
}

const mailsTo = async (to: string) =>
  ((await (await fetch(`http://127.0.0.1:${MAILBOX_PORT}/test/mails`)).json()) as Array<{ to: string }>).filter((m) => m.to === to).length;

/** A code that is not `code`. */
const wrong = (code: string, k = 1) => ((Number(code) + k) % 1_000_000).toString().padStart(6, "0");

async function visitor(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  return page;
}

test("sign-in by emailed code: a visitor confirms its address with one, staff approve, it signs in with another; a code works once, and five wrong tries spend it (ADR 0093)", async ({ browser }) => {
  // Registration: the same panel asks for the code that was mailed.
  const email = "visitor@codes.example";
  const page = await visitor(browser);
  const register = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Register" }) });
  await register.getByLabel("Name").fill("Code Visitor");
  await register.getByLabel("Organisation").fill("Codes SA");
  await register.getByLabel("Work email").fill(email);
  await register.getByRole("button", { name: "Register" }).click();
  await expect(register.getByRole("status")).toContainText("a six-digit code has been sent");
  const code = await codeFor(email, "Your code to confirm your email address");
  await register.getByLabel("Code").fill(wrong(code));
  await register.getByRole("button", { name: "Continue" }).click();
  await expect(register.getByRole("alert")).toContainText("That code is not right, or it has expired");
  await register.getByLabel("Code").fill(`${code.slice(0, 3)} ${code.slice(3)}`); // typed as the mail shows it, with a space
  await register.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/pending$/);

  // Staff approve the confirmed registration.
  const bank = await signedIn(browser, PEOPLE.banker);
  await bank.goto("/bank");
  const row = bank.getByRole("row").filter({ hasText: email });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row.locator(".pill")).toHaveText("approved");

  // An approved registrant signs in with a code of its own; used once, it works no more.
  const staff = PEOPLE.banker.email;
  const signIn = await visitor(browser);
  const panel = signIn.locator("section.panel").filter({ has: signIn.getByRole("heading", { name: "Already registered" }) });
  await panel.getByLabel("Email").fill(staff);
  await panel.getByRole("button", { name: "Send me a code" }).click();
  const staffCode = await codeFor(staff, "Your sign-in code");
  await panel.getByLabel("Code").fill(staffCode);
  await panel.getByRole("button", { name: "Continue" }).click();
  await expect(signIn.locator(".bar nav").getByRole("link", { name: "Bank" })).toBeVisible();

  const again = await visitor(browser);
  const replay = again.locator("section.panel").filter({ has: again.getByRole("heading", { name: "Already registered" }) });
  await replay.getByLabel("Email").fill(staff);
  await replay.getByRole("button", { name: "Send me a code" }).click(); // throttled, silently: no new code
  await replay.getByLabel("Code").fill(staffCode);
  await replay.getByRole("button", { name: "Continue" }).click();
  await expect(replay.getByRole("alert")).toContainText("That code is not right");

  // The mail links to a page that takes the code for its address, opened here in a fresh browser as
  // if from the mail later; the link carries the address, never the code (ADR 0099).
  const linked = PEOPLE.selfCustody.email;
  const asker = await visitor(browser);
  const askFor = asker.locator("section.panel").filter({ has: asker.getByRole("heading", { name: "Already registered" }) });
  await askFor.getByLabel("Email").fill(linked);
  await askFor.getByRole("button", { name: "Send me a code" }).click();
  const linkedCode = await codeFor(linked, "Your sign-in code");
  const mail = ((await (await fetch(`http://127.0.0.1:${MAILBOX_PORT}/test/mails`)).json()) as Array<{ to: string; text: string }>).filter((m) => m.to === linked).at(-1)!;
  const link = mail.text.match(/https?:\/\/\S+\/access\?email=\S+/)![0];
  expect(link, "the link carries no code").not.toContain(linkedCode);
  const fromMail = await (await browser.newContext()).newPage();
  await fromMail.goto(link);
  await expect(fromMail.getByRole("status")).toContainText(`the email sent to ${linked}`);
  await fromMail.getByLabel("Code").fill(linkedCode);
  await fromMail.getByRole("button", { name: "Continue" }).click();
  await expect(fromMail.locator(".bar nav").getByRole("link", { name: "Onboard" })).toBeVisible();
  await expect(fromMail.getByRole("button", { name: "Sign out" })).toBeVisible();

  // Five wrong tries spend a code: the right one is then refused too.
  const spender = PEOPLE.custodied.email;
  const spend = await visitor(browser);
  const form = spend.locator("section.panel").filter({ has: spend.getByRole("heading", { name: "Already registered" }) });
  await form.getByLabel("Email").fill(spender);
  await form.getByRole("button", { name: "Send me a code" }).click();
  const right = await codeFor(spender, "Your sign-in code");
  for (let k = 1; k <= 5; k++) {
    await form.getByLabel("Code").fill(wrong(right, k));
    await form.getByRole("button", { name: "Continue" }).click();
    await expect(form.getByRole("alert")).toContainText("That code is not right");
  }
  await form.getByLabel("Code").fill(right);
  await form.getByRole("button", { name: "Continue" }).click();
  await expect(form.getByRole("alert")).toContainText("That code is not right");
  await expect(spend).toHaveURL(/\/$/);

  // An unknown address gets the same answer, and no mail.
  const unknown = await visitor(browser);
  const ask = unknown.locator("section.panel").filter({ has: unknown.getByRole("heading", { name: "Already registered" }) });
  await ask.getByLabel("Email").fill("nobody@unknown.example");
  await ask.getByRole("button", { name: "Send me a code" }).click();
  await expect(ask.getByRole("status")).toContainText("If the address can be used, a six-digit code has been sent");
  expect(await mailsTo("nobody@unknown.example")).toBe(0);
  for (const p of [page, bank, signIn, again, asker, fromMail, spend, unknown]) await expectHealthy(p);
});
