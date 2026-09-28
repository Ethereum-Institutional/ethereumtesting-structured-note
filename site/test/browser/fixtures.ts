/**
 * What every browser test shares: signing in as one of the seeded people, a browser wallet backed
 * by a local key, the holder wallet, and two guards that fail a test on any page error or any
 * server error Next reports as unhandled (the "Application error" page).
 */
import { readFileSync, statSync } from "node:fs";
import { test as base, expect, type Browser, type Page } from "@playwright/test";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { presentation, SCHEMAS, CORP } from "../standins.ts";
import { COOKIE, PEOPLE, SERVER_LOG, SITE, STANDINS_PORT, type Person } from "./people.ts";

export { expect };

const logSize = () => { try { return statSync(SERVER_LOG).size; } catch { return 0; } };
const logSince = (from: number) => { try { return readFileSync(SERVER_LOG, "utf8").slice(from); } catch { return ""; } };

/** A signed-in page for one person, with the guards attached. */
export async function signedIn(browser: Browser, who: Person): Promise<Page> {
  const context = await browser.newContext();
  await context.addCookies([{ name: COOKIE, value: who.sid, domain: "localhost", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  (page as any).__errors = errors;
  return page;
}

export const test = base.extend<{ guard: void }>({
  guard: [
    async ({}, use, info) => {
      const from = logSize();
      await use();
      const unhandled = logSince(from).split("\n").filter((l) => l.includes("⨯") || /digest/i.test(l));
      expect(unhandled, `server errors while ${info.title}`).toEqual([]);
    },
    { auto: true },
  ],
});

/** Fails if the page shows Next's error page or threw in the browser. */
export async function expectHealthy(page: Page) {
  await expect(page.getByText("Application error")).toHaveCount(0);
  expect((page as any).__errors ?? [], "errors thrown in the page").toEqual([]);
}

/** A key for a self-custody wallet, and a browser wallet (window.ethereum) that signs with it. */
export async function installWallet(page: Page, seed: string) {
  const account = privateKeyToAccount(keccak256(toBytes(seed)));
  await page.exposeFunction("__testSignTypedData", async (json: string) => {
    const td = JSON.parse(json);
    const { EIP712Domain: _d, ...types } = td.types;
    return account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
  });
  await page.addInitScript((address) => {
    (window as any).ethereum = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "eth_signTypedData_v4") return (window as any).__testSignTypedData(params![1]);
        throw new Error(`the test wallet does not support ${method}`);
      },
    };
  }, account.address);
  return account.address;
}

/** The holder wallet: answers the request the site last lodged with the verifier, as a scan would. */
export async function holderPresents(step: "officer" | "wallet", wallet?: string) {
  const request = await (await fetch(`http://127.0.0.1:${STANDINS_PORT}/test/last-lodged`)).json();
  const now = Math.floor(Date.now() / 1000);
  const id = (s: string) => keccak256(toBytes(`${s}/${now}/${request.requestId}`));
  const body =
    step === "officer"
      ? presentation(now, id("root"), request, SCHEMAS.officer, id("officer"), { corporationDid: CORP, role: "CEO" })
      : presentation(now, id("root"), request, SCHEMAS.walletControl, id("wallet"), { walletAddress: wallet, chain: "eip155:1", addressType: "eoa" });
  const res = await fetch(`${SITE}/api/admission/callback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect(res.status, await res.clone().text()).toBe(200);
}

export { PEOPLE };
