import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

export const OUT = path.join(__dirname, "..", "..", "ops", "addresses.json");

/** ISO-3166 numeric country codes used across the demo. */
export const COUNTRY = { SG: 702, HK: 344, JP: 392, AU: 36, US: 840 } as const;

/** Claim topics. 7 = KYC (required by the issuer). 42 = professional investor (required by the venue to LP). */
export const TOPIC = { KYC: 7, PROFESSIONAL: 42 } as const;

export function loadAddresses(): Record<string, any> {
  if (!fs.existsSync(OUT)) return {};
  return JSON.parse(fs.readFileSync(OUT, "utf8"));
}

export function saveAddresses(patch: Record<string, any>) {
  const current = loadAddresses();
  const merged = { ...current, ...patch };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(merged, null, 2) + "\n");
  return merged;
}

/**
 * Signs an ERC-735 claim the way ClaimIssuer.isClaimValid expects: an EIP-191
 * personal-sign over keccak256(abi.encode(identity, topic, data)), produced by a
 * key registered on the issuer with purpose 3 (CLAIM).
 */
export async function signClaim(
  signer: any,
  identityAddress: string,
  topic: number,
  data: string,
): Promise<string> {
  const payload = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "bytes"],
    [identityAddress, topic, data],
  );
  return signer.signMessage(ethers.getBytes(ethers.keccak256(payload)));
}

/** keccak256(abi.encode(address)) -- the key identifier format used by ERC-734. */
export function keyOf(address: string): string {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [address]));
}

export const utf8 = (s: string) => ethers.hexlify(ethers.toUtf8Bytes(s));
