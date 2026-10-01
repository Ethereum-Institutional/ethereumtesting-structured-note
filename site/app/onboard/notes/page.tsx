import { redirect } from "next/navigation";
import Link from "next/link";
import { currentRegistrant } from "@/lib/access";
import { getStore } from "@/lib/store";
import { chainParams } from "@/lib/chains";
import { loadManifest } from "@/lib/chain/manifest";
import { holdingsOf, offersFor, type Placement } from "@/lib/notes/place";
import { acceptanceDoneAction, prepareAcceptanceAction } from "../../actions";
import { accountOf, walletOf } from "../account";
import { AcceptOffer } from "./AcceptOffer";
import { AddToken } from "../AddToken";

export const dynamic = "force-dynamic";

const euros = (cents: string | bigint) => `€${(Number(cents) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
const at = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** The notes the bank offers the client, and those it holds (ADR 0075). */
export default async function Notes() {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const { wallet, held } = await accountOf(who);
  const account = wallet ?? held;
  const chain = chainParams(loadManifest().chainId);
  const [offers, holdings, mine] = await Promise.all([
    offersFor(who),
    account ? holdingsOf(walletOf(account)).catch(() => []) : Promise.resolve([]),
    getStore().admissionsFor(who.id),
  ]);
  const ids = new Set(mine.map((x) => x.id));
  const settled = (await getStore().listNotes()).flatMap((note) =>
    ((note.data.placements ?? []) as Placement[]).filter((p) => p.status !== "offered" && ids.has(p.admission)).map((p) => ({ note, p })),
  );
  return (
    <>
      <h2 id="notes">Notes</h2>
      {!account && (
        <section className="panel"><p className="muted" style={{ margin: 0 }}>Onboard an account first, under <Link href="/onboard">Account</Link>.</p></section>
      )}

      {account && (
        <section className="panel" aria-label="Offered to you">
          <h3 style={{ marginTop: 0 }}>Offered to you</h3>
          {offers.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>
              {(account.data as Record<string, any>).regS ? "No offer is open." : "Your bank approves you for its notes under Regulation S before offering them; no offer is open."}
            </p>
          )}
          {offers.map(({ note, placement: p }) => {
            const deadline = new Date(Date.parse(p.offeredAt) + 24 * 3600_000).toISOString();
            return (
              <div className="offer" key={`${note.id}/${p.id}`}>
                <dl className="facts" style={{ margin: 0 }}>
                  <dt>Note</dt><dd>{note.name} ({note.symbol})</dd>
                  <dt>Units</dt><dd>{p.units}</dd>
                  <dt>Price</dt><dd>{euros(p.priceCents)}, {euros(BigInt(p.priceCents) / BigInt(p.units))} a unit, paid in the deposit</dd>
                  <dt>Open until</dt><dd>{at(deadline)} UTC</dd>
                </dl>
                <p className="muted" style={{ margin: 0 }}>
                  Two transactions: an allowance of the price to the settlement contract, then the acceptance. The units and the
                  price move together in the second, or neither does.
                </p>
                <AcceptOffer noteId={note.id} tradeId={p.id} chain={chain} prepare={prepareAcceptanceAction} done={acceptanceDoneAction} />
              </div>
            );
          })}
        </section>
      )}

      {account && (
        <section className="panel" aria-label="Held">
          <h3 style={{ marginTop: 0 }}>Held</h3>
          {holdings.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>{held && !wallet ? "Your custody account holds no notes." : "Your wallet holds no notes."}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Note</th><th>Units</th><th /></tr></thead>
                <tbody>
                  {holdings.map(({ note, units }) => (
                    <tr key={note.id}>
                      <td>{note.name} ({note.symbol})</td>
                      <td>{String(units)}</td>
                      <td>{wallet && <AddToken chain={chain} asset={{ address: note.addresses.note, symbol: note.symbol, decimals: 0 }} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {settled.length > 0 && (
            <details style={{ marginTop: "1rem" }}>
              <summary className="muted">Earlier offers ({settled.length})</summary>
              <ul className="muted">
                {settled.map(({ note, p }) => (
                  <li key={`${note.id}/${p.id}`}>{at(p.offeredAt)}: {p.units} units of {note.symbol} for {euros(p.priceCents)}, {p.status}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}
