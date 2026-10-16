import "server-only";
import { indexed } from "../chain/events.ts";
import { formatUnits, parseAbi, type Address, type Hex } from "viem";
import { getStore, type Registrant } from "../store.ts";
import { hasRole } from "../operators.ts";
import { notesOnRecord, chainClient } from "../notes/registry.ts";
import { depositToken } from "./deposit.ts";
import { dataOf, offboard } from "./onboarding.ts";

/**
 * A client closing an account (ADR 0107). The client asks, with its reason; the bank confirms
 * through its offboarding, which revokes its claim and removes the wallet from every registry. A
 * wallet so removed can neither receive nor sell, so the request is refused while the account holds
 * anything, has units locked in an offer, or is owed a distribution, and checked again at confirming.
 */

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const PAYING_AGENT = parseAbi([
  "function distributions(bytes32 id) view returns (uint48 recordTime, uint64 perCa, uint64 unitsEntitled, uint64 unitsPaid, bool open, bool closed, uint8 kind, bool reversed, uint64 unitsReversed, uint256 dateIndex)",
  "function settled(bytes32 id, address holder) view returns (bool)",
  "function held(bytes32 id, address holder) view returns (uint256)",
]);
const RECORD_DATES = parseAbi(["function balanceAt(address account, uint256 time) view returns (uint256)"]);

/** What an account still holds or is owed, in words; empty when it may close. */
export async function stillHeld(wallet: Address): Promise<string[]> {
  const { c } = chainClient();
  const out: string[] = [];
  const dep = depositToken();
  const cash = await c.readContract({ address: dep.address, abi: ERC20, functionName: "balanceOf", args: [wallet] });
  if (cash > 0n) out.push(`${formatUnits(cash, dep.decimals)} ${dep.symbol} of the deposit`);
  for (const n of await notesOnRecord()) {
    const units = await c.readContract({ address: n.token, abi: ERC20, functionName: "balanceOf", args: [wallet] });
    // Units an offer locks are still the holder's: counted here.
    if (units > 0n) out.push(`${units} units of ${n.symbol}`);
    const payingAgent = n.note.addresses.payingAgent as Address | undefined;
    const recordDates = n.note.addresses.recordDates as Address | undefined;
    if (!payingAgent || !recordDates) continue;
    const opened = await indexed({ addresses: [payingAgent], names: ["Opened"] });
    for (const log of opened) {
      const id = log.args.id as Hex;
      const [held, settled, dist] = await Promise.all([
        c.readContract({ address: payingAgent, abi: PAYING_AGENT, functionName: "held", args: [id, wallet] }),
        c.readContract({ address: payingAgent, abi: PAYING_AGENT, functionName: "settled", args: [id, wallet] }),
        c.readContract({ address: payingAgent, abi: PAYING_AGENT, functionName: "distributions", args: [id] }),
      ]);
      const kind = dist[6] === 0 ? "coupon" : "redemption";
      if (held > 0n) out.push(`a ${kind} of ${n.symbol} held for it, to be claimed`);
      else if (!dist[5] && !settled) {
        const ofRecord = await c.readContract({ address: recordDates, abi: RECORD_DATES, functionName: "balanceAt", args: [wallet, BigInt(dist[0])] });
        if (ofRecord > 0n) out.push(`a ${kind} of ${n.symbol} not yet paid to it`);
      }
    }
  }
  return out;
}

function refusal(held: string[]): Error {
  return new Error(`The account cannot close while it holds or is owed anything: ${held.join("; ")}. Sell, transfer or claim it first.`);
}

/** The client asks to close an onboarded account, with its reason. */
export async function requestClose(client: Registrant, id: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error("Give the reason.");
  const store = getStore();
  const a = await store.admissionById(id);
  if (!a || a.registrantId !== client.id) throw new Error("Not your account.");
  const d = dataOf(a);
  if (a.status !== "onboarded" || !d.wallet) throw new Error("Only an onboarded account can be closed.");
  if (d.closeRequest) return;
  const held = await stillHeld(d.wallet);
  if (held.length) throw refusal(held);
  const at = new Date().toISOString();
  await store.updateAdmission({ ...a, data: { ...a.data, closeRequest: { by: client.email, at, reason: reason.trim() } } }, a.status);
  await store.audit({ at, actor: client.email, action: `asked to close ${d.wallet}: ${reason.trim()}`, subject: a.id });
}

/** The client withdraws its request, before the bank acts on it. */
export async function withdrawClose(client: Registrant, id: string): Promise<void> {
  const store = getStore();
  const a = await store.admissionById(id);
  if (!a || a.registrantId !== client.id) throw new Error("Not your account.");
  if (a.status !== "onboarded" || !dataOf(a).closeRequest) return;
  const { closeRequest: _r, ...rest } = a.data as Record<string, unknown>;
  await store.updateAdmission({ ...a, data: rest }, a.status);
  await store.audit({ at: new Date().toISOString(), actor: client.email, action: `withdrew the request to close ${dataOf(a).wallet}`, subject: a.id });
}

/** The bank closes the account as asked, through its offboarding, once nothing is held or owed. */
export async function confirmClose(staff: Registrant, id: string): Promise<void> {
  if (!hasRole(staff.email, "bank")) throw new Error("Not permitted.");
  const a = await getStore().admissionById(id);
  if (!a) throw new Error("No such account.");
  const d = dataOf(a);
  if (a.status !== "onboarded" || !d.closeRequest || !d.wallet) throw new Error("This account has not asked to close.");
  const held = await stillHeld(d.wallet);
  if (held.length) throw refusal(held);
  await offboard(staff, id, `Closed at the client's request: ${d.closeRequest.reason}`);
}
