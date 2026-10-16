import "server-only";
import { getStore, type Admission } from "../store.ts";

/**
 * What an account is called (ADR 0110): the bank's client it was confirmed against, by its legal
 * name, once the bank has confirmed it; until then, and on the existing-identity route, which has no
 * client of the bank's, the organisation of whoever asked. The organisation is the registrant's own
 * words at sign-up, not the bank's record, so it names a request but never an account.
 */
export async function accountNamer(): Promise<(a: Admission) => string> {
  const clients = await getStore().listClients();
  const legal = new Map(clients.map((c) => [c.kycReference, String(c.claims.legalName)]));
  return (a) => {
    const d = a.data as { kycReference?: string; request?: { organisation?: string } };
    return (d.kycReference && legal.get(d.kycReference)) || d.request?.organisation || "Account";
  };
}
