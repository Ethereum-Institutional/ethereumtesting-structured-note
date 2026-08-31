import "server-only";
import { type Address } from "viem";
import { publicClient, addresses, decodeFlags } from "./chain";
import { CHECKER_ABI, IDENTITY_REGISTRY_ABI, TREX_TOKEN_ABI } from "./abis";

/**
 * On-chain status for a prospective or existing holder.
 *
 * The application record itself lives in the database (lib/db). This file answers only the
 * chain-side question the portal needs alongside it: what, right now, is this wallet permitted
 * to do, and if nothing, which gate is stopping it?
 */

export type ApplicantStatus = {
  registered: boolean;
  verified: boolean;
  frozen: boolean;
  canSwap: boolean;
  canProvideLiquidity: boolean;
  /** The first gate that fails, in the order the checker applies them. */
  gate: string;
  assetBalance: bigint;
};

export async function applicantStatus(wallet: Address): Promise<ApplicantStatus> {
  const a = addresses();
  const [registered, verified, frozen, balance, explain] = await Promise.all([
    publicClient.readContract({ address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_ABI, functionName: "contains", args: [wallet] }) as Promise<boolean>,
    publicClient.readContract({ address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_ABI, functionName: "isVerified", args: [wallet] }) as Promise<boolean>,
    publicClient.readContract({ address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "isFrozen", args: [wallet] }) as Promise<boolean>,
    publicClient.readContract({ address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "balanceOf", args: [wallet] }) as Promise<bigint>,
    publicClient.readContract({ address: a.venue.allowlistChecker, abi: CHECKER_ABI, functionName: "explain", args: [wallet, a.trex.token] }) as Promise<any>,
  ]);

  const flags = decodeFlags(explain[6]);
  const gate = !explain[0]
    ? "asset not registered at venue"
    : explain[1]
      ? "asset paused by issuer"
      : explain[2]
        ? "wallet frozen"
        : !explain[3]
          ? "identity not verified"
          : !explain[4]
            ? "jurisdiction blocked at venue"
            : "clear";

  return {
    registered,
    verified,
    frozen,
    canSwap: flags.swap,
    canProvideLiquidity: flags.liquidity,
    gate,
    assetBalance: balance,
  };
}
