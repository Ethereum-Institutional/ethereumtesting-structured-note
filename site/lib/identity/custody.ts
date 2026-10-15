import "server-only";
import { parseAbi, type Address, type Hex } from "viem";
import { context } from "./onchain.ts";

/**
 * Custodians (ADR 0089): the bank's custody platform and a third-party custodian, each opening
 * segregated custody accounts from its own factory and signing for them (EIP-1271 by its key).
 * Each manages the identities of the accounts it holds, since key custody follows custody.
 */

export type Custodian = "bank" | "third-party";

const FACTORY = parseAbi([
  "function createAccount(string clientRef) returns (address)",
  "function predictAddress(string clientRef) view returns (address)",
]);

/** The custodian's signing capacity, its factory, and its name. */
export function custodian(which: Custodian): { capacity: string; factory: Address; label: string } {
  const { m } = context();
  if (!m.custody) throw new Error("the manifest has no custody accounts");
  if (which === "bank") return { capacity: "custodian", factory: m.custody.factory, label: "the bank's custody platform" };
  if (!m.custody.thirdParty) throw new Error("the manifest has no third-party custodian");
  return { capacity: "thirdPartyCustodian", factory: m.custody.thirdParty.factory as Address, label: "the third-party custodian" };
}

/** The custodian's own address: the manager of the identities it holds. */
export function custodianAddress(which: Custodian): Address {
  return context().s.address(custodian(which).capacity);
}

/** Opens the client's account, or returns it if it is open already. */
export async function openAccount(which: Custodian, clientRef: string): Promise<Address> {
  const { s } = context();
  const { capacity, factory } = custodian(which);
  const predicted = await s.publicClient.readContract({ address: factory, abi: FACTORY, functionName: "predictAddress", args: [clientRef] });
  const code = await s.publicClient.getCode({ address: predicted });
  if (!code || code === "0x") await s.send(capacity, { address: factory, abi: FACTORY, functionName: "createAccount", args: [clientRef] });
  return predicted;
}

/** The account a custodian opens for a client reference. */
export function accountFor(which: Custodian, clientRef: string): Promise<Address> {
  const { s } = context();
  return s.publicClient.readContract({ address: custodian(which).factory, abi: FACTORY, functionName: "predictAddress", args: [clientRef] });
}

/** The custody account's signature: its custodian signs, and the account answers EIP-1271. */
export function signAsAccount(which: Custodian, typedData: Record<string, any>): Promise<Hex> {
  return context().s.signTypedData(custodian(which).capacity, typedData);
}
