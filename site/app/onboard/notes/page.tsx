import { redirect } from "next/navigation";
import Link from "next/link";
import { currentRegistrant } from "@/lib/access";
import { getStore, type DemoNote } from "@/lib/store";
import { chainParams } from "@/lib/chains";
import { loadManifest } from "@/lib/chain/manifest";
import { holdingsOf, lockedSettlement, offersFor, type Offer } from "@/lib/notes/place";
import { paymentsTo } from "@/lib/notes/lifecycle";
import { acceptanceDoneAction, prepareAcceptanceAction, prepareCancelAction, prepareOfferAction, walletActedAction } from "../../actions";
import { accountOf, walletOf } from "../account";
import { WalletSteps } from "./WalletSteps";
import { PostOffer } from "./PostOffer";
import { AddToken } from "../AddToken";

export const dynamic = "force-dynamic";

const euros = (cents: string | bigint) => `€${(Number(cents) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
const at = (s: number) => new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const what = (o: Offer) => (o.kind === "placement" ? "Placement by the Issuer" : o.kind === "buy-back" ? "Buy-back by the Issuer" : "Transfer");

/** The notes offered to the client, its own offers and holdings, and what it was paid. */
export default async function Notes() {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const { wallet, held, noteEligible } = await accountOf(who);
  const account = wallet ?? held;
  const chain = chainParams(loadManifest().chainId);
  const [offers, holdings, payments, notes] = await Promise.all([
    offersFor(who),
    account ? holdingsOf(walletOf(account)).catch(() => []) : Promise.resolve([]),
    account ? paymentsTo(walletOf(account)).catch(() => []) : Promise.resolve([]),
    getStore().listNotes(),
  ]);
  const tradable = notes.filter((n) => n.status === "issued" && lockedSettlement(n));
  const approved = noteEligible;
  const ownWallet = Boolean(wallet);

  /** One offer, with what this client does about it. */
  const OfferCard = ({ note, offer, act }: { note: DemoNote; offer: Offer; act: "take" | "withdraw" }) => {
    const iBuy = offer.side === "sell"; // the proposer sells, so the taker buys
    return (
      <div className="offer">
        <dl className="facts" style={{ margin: 0 }}>
          <dt>Note</dt><dd>{note.name} ({note.symbol})</dd>
          <dt>{act === "take" ? "You would" : "You offer to"}</dt>
          <dd>{act === "take" ? (iBuy ? "buy" : "sell") : offer.side} {offer.units} unit{offer.units === 1 ? "" : "s"} for {euros(offer.priceCents)}, {euros(BigInt(offer.priceCents) / BigInt(offer.units))} a unit</dd>
          <dt>From</dt><dd>{offer.kind === "transfer" ? (act === "take" ? "a client of the bank" : offer.counterparty ? "a client named by your bank" : "open to any approved client") : "the Issuer"}</dd>
          <dt>Open until</dt><dd>{at(offer.deadline)}</dd>
        </dl>
        {ownWallet && act === "take" && (
          <div className="actions">
            <WalletSteps
              label={offer.kind === "placement" ? "Accept with MetaMask" : iBuy ? "Buy with MetaMask" : "Sell with MetaMask"}
              chain={chain}
              prepare={prepareAcceptanceAction.bind(null, note.id, offer.id)}
              done={acceptanceDoneAction.bind(null, note.id, offer.id)}
              settledSays={iBuy ? "Settled: the units are in your wallet." : "Settled: the price is in your wallet."}
            />
            {offer.counterparty && (
              <WalletSteps label="Decline" quiet chain={chain} prepare={prepareCancelAction.bind(null, note.id, offer.id)} done={walletActedAction.bind(null, note.id, "")} settledSays="Declined." />
            )}
          </div>
        )}
        {ownWallet && act === "withdraw" && (
          <WalletSteps label="Withdraw with MetaMask" quiet chain={chain} prepare={prepareCancelAction.bind(null, note.id, offer.id)} done={walletActedAction.bind(null, note.id, "")} settledSays="Withdrawn: your lock is released." />
        )}
        {!ownWallet && <p className="muted" style={{ margin: 0 }}>Your bank acts on this for your custody account.</p>}
      </div>
    );
  };

  return (
    <>
      <h2 id="notes">Notes</h2>
      {!account && (
        <section className="panel"><p className="muted" style={{ margin: 0 }}>Onboard an account first, under <Link href="/onboard">Account</Link>.</p></section>
      )}

      {account && offers.arranged.length > 0 && (
        <section className="panel" aria-label="Arranged by your bank">
          <h3 style={{ marginTop: 0 }}>Arranged by your bank</h3>
          {offers.arranged.map(({ note, arranged }) => (
            <div className="offer" key={arranged.ref}>
              <p style={{ margin: 0 }}>
                Sell {arranged.units} unit{arranged.units === 1 ? "" : "s"} of {note.symbol} for {euros(arranged.priceCents)}
                {arranged.buyer ? " to a client of the bank" : ", open to any approved client"}. Your offer locks the units in your
                wallet until it is taken or you withdraw it.
              </p>
              <WalletSteps
                label="Offer with MetaMask"
                chain={chain}
                prepare={prepareOfferAction.bind(null, note.id, { arranged: arranged.ref })}
                done={walletActedAction.bind(null, note.id, arranged.ref)}
                settledSays="Offered: your units are locked until it is taken."
              />
            </div>
          ))}
        </section>
      )}

      {account && (
        <section className="panel" aria-label="Offered to you">
          <h3 style={{ marginTop: 0 }}>Offered to you</h3>
          {offers.toMe.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>{approved ? "No offer is open." : "Your bank approves you for its notes under Regulation S before offering them; no offer is open."}</p>
          )}
          {offers.toMe.map(({ note, offer }) => <OfferCard key={`${note.id}/${offer.id}`} note={note} offer={offer} act="take" />)}
        </section>
      )}

      {account && approved && (
        <section className="panel" aria-label="Open offers">
          <h3 style={{ marginTop: 0 }}>Open offers</h3>
          <p className="muted">Offers any approved client may take, without their makers' names. The first to take one settles it.</p>
          {offers.open.length === 0 && <p className="muted" style={{ margin: 0 }}>None is open.</p>}
          {offers.open.map(({ note, offer }) => <OfferCard key={`${note.id}/${offer.id}`} note={note} offer={offer} act="take" />)}
        </section>
      )}

      {account && ownWallet && approved && (
        <section className="panel" aria-label="Your offers">
          <h3 style={{ marginTop: 0 }}>Your offers</h3>
          {offers.mine.map(({ note, offer }) => <OfferCard key={`${note.id}/${offer.id}`} note={note} offer={offer} act="withdraw" />)}
          {tradable.map((n) => (
            <details key={n.id} style={{ marginTop: "1rem" }}>
              <summary>Make an offer on {n.symbol}…</summary>
              <div style={{ marginTop: "0.75rem" }}>
                <PostOffer noteId={n.id} symbol={n.symbol} chain={chain} prepare={prepareOfferAction.bind(null, n.id)} done={walletActedAction.bind(null, n.id, "")} />
              </div>
            </details>
          ))}
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
                <thead><tr><th>Note</th><th>Units</th><th>Locked in offers</th><th /></tr></thead>
                <tbody>
                  {holdings.map(({ note, units, locked }) => (
                    <tr key={note.id}>
                      <td>{note.name} ({note.symbol})</td>
                      <td>{String(units)}</td>
                      <td>{String(locked)}</td>
                      <td>{wallet && <AddToken chain={chain} asset={{ address: note.addresses.note, symbol: note.symbol, decimals: 0 }} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {payments.length > 0 && (
            <>
              <h4 style={{ margin: "1.25rem 0 0.5rem" }}>Paid to you</h4>
              <div className="table-wrap">
                <table aria-label="Paid to you">
                  <thead><tr><th>Note</th><th>Date</th><th>For</th><th>Units</th><th>Amount</th></tr></thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={`${p.note.id}/${p.date}/${p.kind}`}>
                        <td>{p.note.symbol}</td>
                        <td>{p.date + 1}</td>
                        <td>{p.kind === "coupon" ? "Coupon" : "Redemption"}</td>
                        <td>{p.units}</td>
                        <td>{euros(p.amount)}{p.held ? ", held until your account can receive it" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {offers.done.length > 0 && (
            <details style={{ marginTop: "1rem" }}>
              <summary className="muted">Earlier offers ({offers.done.length})</summary>
              <ul className="muted">
                {offers.done.map(({ note, offer }) => (
                  <li key={`${note.id}/${offer.id}`}>{what(offer)}: {offer.units} units of {note.symbol} for {euros(offer.priceCents)}, {offer.status}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}
