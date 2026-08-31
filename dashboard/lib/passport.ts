import "server-only";
import { type Address } from "viem";
import { publicClient, addresses } from "./chain";
import { ID_FACTORY_ABI, IDENTITY_ABI, IDENTITY_REGISTRY_ABI, TREX_TOKEN_ABI } from "./abis";

/**
 * The investor's on-chain passport, read live.
 *
 * Everything here comes from the chain, not the application database — that is the point the
 * passport card makes: the credential the market checks is public and verifiable, and this app
 * is merely displaying it.
 */

const ZERO = "0x0000000000000000000000000000000000000000";

export type Passport = {
  /** The ONCHAINID contract, or null if none has been minted for this wallet. */
  identity: Address | null;
  /** A KYC claim, signed by the trusted claim issuer, exists on the identity. */
  kyc: boolean;
  /** The professional/accredited-investor claim exists on the identity. */
  accredited: boolean;
  /** The issuer's identity registry considers this wallet verified. */
  verified: boolean;
  frozen: boolean;
  /** ISO 3166 numeric country the registry holds for this wallet; 0 until registered. */
  country: number;
};

export async function passportOf(wallet: Address): Promise<Passport> {
  const a = addresses();

  const [identity, verified, frozen, country] = await Promise.all([
    publicClient.readContract({
      address: a.trex.idFactory, abi: ID_FACTORY_ABI, functionName: "getIdentity", args: [wallet],
    }) as Promise<Address>,
    publicClient.readContract({
      address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_ABI, functionName: "isVerified", args: [wallet],
    }) as Promise<boolean>,
    publicClient.readContract({
      address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "isFrozen", args: [wallet],
    }) as Promise<boolean>,
    publicClient
      .readContract({
        address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_ABI, functionName: "investorCountry", args: [wallet],
      })
      .then(Number)
      .catch(() => 0),
  ]);

  if (identity === ZERO) {
    return { identity: null, kyc: false, accredited: false, verified, frozen, country };
  }

  const [kycClaims, proClaims] = await Promise.all([
    publicClient.readContract({
      address: identity, abi: IDENTITY_ABI, functionName: "getClaimIdsByTopic", args: [BigInt(a.topics.KYC)],
    }) as Promise<readonly `0x${string}`[]>,
    publicClient.readContract({
      address: identity, abi: IDENTITY_ABI, functionName: "getClaimIdsByTopic", args: [BigInt(a.topics.PROFESSIONAL)],
    }) as Promise<readonly `0x${string}`[]>,
  ]);

  return {
    identity,
    kyc: kycClaims.length > 0,
    accredited: proClaims.length > 0,
    verified,
    frozen,
    country,
  };
}
