/**
 * What every browser test shares: signing in as one of the seeded people, a browser wallet backed
 * by a local key, and two guards that fail a test on any page error or any
 * server error Next reports as unhandled (the "Application error" page).
 */
import { readFileSync, statSync } from "node:fs";
import { test as base, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, toBytes } from "viem";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { COOKIE, PEOPLE, SERVER_LOG, type Person } from "./people.ts";

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

/**
 * A key, and a browser wallet (window.ethereum) that signs with it, as MetaMask does: it starts on
 * Ethereum mainnet, does not know the pool's chain until asked to add it (4902), and signs typed
 * data only on the chain its domain names. Every request is recorded in window.__walletCalls.
 */
export type WalletQuirks = {
  /**
   * MetaMask with networks per site: it reports the pool's chain (hex) as the site's, while the
   * chain it signs on is another (Base, 8453), until the site asks to switch.
   */
  reportsPoolChain?: string;
  /** The user declines the first signature request (4001). */
  declineFirstSignature?: boolean;
};

export async function installWallet(page: Page, seed: string, quirks: WalletQuirks = {}) {
  const account = privateKeyToAccount(keccak256(toBytes(seed)));
  const chainRpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const sender = createWalletClient({ account, transport: http(chainRpc) });
  const reader = createPublicClient({ transport: http(chainRpc) });
  // Transactions go to the local chain from the same key, as MetaMask would send them.
  await page.exposeFunction("__testSendTransaction", async (tx: { to: `0x${string}`; data: `0x${string}` }) => sender.sendTransaction({ to: tx.to, data: tx.data, chain: null }));
  await page.exposeFunction("__testReceipt", async (hash: `0x${string}`) => {
    const r = await reader.getTransactionReceipt({ hash }).catch(() => null);
    return r ? { status: r.status === "success" ? "0x1" : "0x0" } : null;
  });
  // Reads a wallet passes to its node: a balance, an estimate, the gas price.
  await page.exposeFunction("__testRpc", async (method: string, params: unknown[]) => reader.request({ method: method as any, params: params as any }));
  await page.exposeFunction("__testSignTypedData", async (json: string) => {
    const td = JSON.parse(json);
    const { EIP712Domain: _d, ...types } = td.types;
    return account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
  });
  await page.addInitScript(({ address, quirks }) => {
    const w = window as any;
    w.__walletCalls = [];
    let chainId = quirks.reportsPoolChain ? "0x2105" : "0x1";
    let reported: string | null = quirks.reportsPoolChain ?? null;
    let declines = quirks.declineFirstSignature ? 1 : 0;
    const known = new Set(["0x1", "0x2105", ...(quirks.reportsPoolChain ? [quirks.reportsPoolChain] : [])]);
    w.ethereum = {
      request: async ({ method, params }: { method: string; params?: any[] }) => {
        w.__walletCalls.push(method);
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "eth_chainId") return reported ?? chainId;
        if (method === "wallet_switchEthereumChain") {
          const wanted = String(params![0].chainId).toLowerCase();
          if (!known.has(wanted)) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
          chainId = wanted;
          reported = null;
          return null;
        }
        if (method === "wallet_addEthereumChain") {
          const added = String(params![0].chainId).toLowerCase();
          known.add(added);
          chainId = added;
          reported = null;
          return null;
        }
        if (method === "eth_signTypedData_v4") {
          if (declines > 0) {
            declines--;
            throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          }
          const td = JSON.parse(params![1]);
          if (td.domain?.chainId !== undefined && `0x${Number(td.domain.chainId).toString(16)}` !== chainId) {
            throw new Error(`Provided chainId "${td.domain.chainId}" must match the active chainId "${parseInt(chainId, 16)}"`);
          }
          return w.__testSignTypedData(params![1]);
        }
        if (method === "eth_sendTransaction") return w.__testSendTransaction(params![0]);
        if (method === "wallet_watchAsset") {
          w.__watched = [...(w.__watched ?? []), (params as any).options.symbol];
          return true;
        }
        if (method === "eth_getTransactionReceipt") return w.__testReceipt(params![0]);
        if (method === "eth_getBalance" || method === "eth_estimateGas" || method === "eth_gasPrice") return w.__testRpc(method, params ?? []);
        throw new Error(`the test wallet does not support ${method}`);
      },
    };
  }, { address: account.address, quirks });
  return account.address;
}

/** Gas and test payment tokens for a wallet, minted by the local token's owner (anvil account 0). */
export async function fundWallet(address: `0x${string}`, paymentUnits: bigint) {
  const chainRpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const reader = createPublicClient({ transport: http(chainRpc) });
  await reader.request({ method: "anvil_setBalance" as any, params: [address, "0x56BC75E2D63100000"] as any });
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "ops", "addresses.json"), "utf8"));
  const owner = createWalletClient({ account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"), transport: http(chainRpc) });
  const hash = await owner.writeContract({ address: manifest.assets.paymentToken.address, abi: parseAbi(["function mint(address to, uint256 amount)"]), functionName: "mint", args: [address, paymentUnits], chain: null });
  await reader.waitForTransactionReceipt({ hash });
}

/** Sets an address's ETH on the local chain, in wei. */
export async function setEth(address: string, wei: bigint) {
  const reader = createPublicClient({ transport: http(process.env.RPC_URL ?? "http://127.0.0.1:8545") });
  await reader.request({ method: "anvil_setBalance" as any, params: [address, `0x${wei.toString(16)}`] as any });
}

/** Moves the local chain's clock to just past `t` (Unix seconds) and mines a block there. */
export async function warpTo(t: number) {
  const reader = createPublicClient({ transport: http(process.env.RPC_URL ?? "http://127.0.0.1:8545") });
  const latest = Number((await reader.getBlock()).timestamp);
  if (latest <= t) await reader.request({ method: "evm_increaseTime" as any, params: [t - latest + 1] as any });
  await reader.request({ method: "evm_mine" as any, params: [] as any });
  await new Promise((r) => setTimeout(r, 1600)); // past the lagging RPC's window
}

/** Chooses a client in a Client dropdown by its legal name; the site assigns references. */
export async function chooseClient(select: Locator, legalName: string) {
  const value = await select.locator("option", { hasText: legalName }).first().getAttribute("value");
  await select.selectOption(value!);
}

export { PEOPLE };
