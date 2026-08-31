import "server-only";
import fs from "node:fs";
import path from "node:path";
import { formatUnits, type Address } from "viem";
import { publicClient, addresses, decodeFlags, COUNTRY_NAMES } from "./chain";
import { TREX_TOKEN_ABI, IDENTITY_REGISTRY_ABI, CHECKER_ABI, ADAPTER_ABI } from "./abis";

/**
 * Everything the /build page asserts, gathered from the chain rather than written down.
 *
 * The page's whole claim is that the walkthrough is real, so any number it shows should come
 * from the deployment it is describing. Contract sizes are read as deployed bytecode length,
 * verification states from the issuer's registry, permissions from the live checker.
 */

const CONTENT = path.join(process.cwd(), "content");

export type ProofBundle = {
  ok: boolean;
  reason?: string;
  mcp: { tokenSource: string; hookScaffold: string; calls: any };
  sizes: Array<{ name: string; address: Address; bytes: number; role: string }>;
  issuer: {
    token: Address;
    identityRegistry: Address;
    claimIssuer: Address;
    symbol: string;
    supply: string;
    holders: Array<{ name: string; wallet: Address; country: string; verified: boolean; claims: number[] }>;
  };
  venueOnboarding: {
    adapter: Address;
    adapterIdentity: Address;
    adapterVerified: boolean;
    adapterSeedWei: string;
  };
  permissions: Array<{ label: string; address: Address; flags: string; swap: boolean; liquidity: boolean; note: string }>;
  tests: any;
};

function readContent(file: string): string {
  try {
    return fs.readFileSync(path.join(CONTENT, file), "utf8");
  } catch {
    return "";
  }
}

export async function buildProof(): Promise<ProofBundle> {
  const mcp = {
    tokenSource: readContent("mcp/rwa-token.sol"),
    hookScaffold: readContent("mcp/hook-scaffold.sol"),
    calls: JSON.parse(readContent("mcp/calls.json") || "{}"),
  };
  const tests = JSON.parse(readContent("test-results.json") || "{}");

  let a: ReturnType<typeof addresses>;
  try {
    a = addresses();
  } catch {
    return { ok: false, reason: "No deployment manifest available.", mcp, sizes: [], issuer: null as any, venueOnboarding: null as any, permissions: [], tests };
  }

  try {
    const codeSize = async (address: Address) => {
      const code = await publicClient.getCode({ address });
      return code ? (code.length - 2) / 2 : 0;
    };

    const named: Array<[string, Address, string]> = [
      ["ERC3643AllowlistChecker", a.venue.allowlistChecker, "Translates ERC-3643 identity into Uniswap permissions — ours"],
      ["PermissionedComplianceHook", a.venue.hook, "Gates every swap and liquidity add — ours"],
      ["CustodyAccount (CLIENT-A)", a.custody["CLIENT-A"], "One segregated client account — ours"],
      ["PermissionsAdapter", a.venue.permissionsAdapter, "Custodies the asset, mints the tradeable wrapper — Uniswap"],
      ["PoolManager", a.venue.poolManager, "Uniswap v4 core"],
      ["T-REX Token", a.trex.token, "ERC-3643 security token — Tokeny"],
    ];
    const sizes = await Promise.all(
      named.map(async ([name, address, role]) => ({ name, address, bytes: await codeSize(address), role })),
    );

    const [symbol, supply, decimals] = await Promise.all([
      publicClient.readContract({ address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "symbol" }),
      publicClient.readContract({ address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "totalSupply" }),
      publicClient.readContract({ address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "decimals" }),
    ]);

    const holders = await Promise.all(
      a.investors.map(async (i) => ({
        name: i.name,
        wallet: i.wallet,
        country: COUNTRY_NAMES[i.country] ?? String(i.country),
        verified: (await publicClient.readContract({
          address: a.trex.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: "isVerified",
          args: [i.wallet],
        })) as boolean,
        claims: i.claims ?? [],
      })),
    );

    const [adapterVerified, adapterSeed] = await Promise.all([
      publicClient.readContract({
        address: a.trex.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "isVerified",
        args: [a.venue.permissionsAdapter],
      }) as Promise<boolean>,
      publicClient.readContract({
        address: a.trex.token,
        abi: TREX_TOKEN_ABI,
        functionName: "balanceOf",
        args: [a.venue.permissionsAdapter],
      }) as Promise<bigint>,
    ]);

    // The three outcomes the compliance seam produces, straight from the live checker.
    const subjects: Array<[string, Address, string]> = [
      ["CLIENT-A · Sakura (JP, professional)", a.custody["CLIENT-A"], "KYC + professional claim"],
      ["CLIENT-C · Harbour (HK, retail)", a.custody["CLIENT-C"], "KYC only — no professional claim"],
      ["CLIENT-D · Prospect (KYC pending)", a.custody["CLIENT-D"], "No identity registered"],
    ];
    const permissions = await Promise.all(
      subjects.map(async ([label, address, note]) => {
        const raw = (await publicClient.readContract({
          address: a.venue.allowlistChecker,
          abi: CHECKER_ABI,
          functionName: "checkAllowlist",
          args: [address, a.trex.token],
        })) as `0x${string}`;
        const f = decodeFlags(raw);
        return { label, address, flags: raw, swap: f.swap, liquidity: f.liquidity, note };
      }),
    );

    return {
      ok: true,
      mcp,
      sizes,
      issuer: {
        token: a.trex.token,
        identityRegistry: a.trex.identityRegistry,
        claimIssuer: a.trex.claimIssuer,
        symbol: symbol as string,
        supply: formatUnits(supply as bigint, Number(decimals)),
        holders,
      },
      venueOnboarding: {
        adapter: a.venue.permissionsAdapter,
        adapterIdentity: (a as any).adapterIdentity,
        adapterVerified,
        adapterSeedWei: (adapterSeed as bigint).toString(),
      },
      permissions,
      tests,
    };
  } catch (err: any) {
    return {
      ok: false,
      reason: String(err?.shortMessage ?? err?.message ?? err).slice(0, 200),
      mcp,
      sizes: [],
      issuer: null as any,
      venueOnboarding: null as any,
      permissions: [],
      tests,
    };
  }
}
