"use client";

import { useRef } from "react";
import type { ChainParams } from "@/lib/chains";
import { WalletSteps } from "./WalletSteps";

/** A client's own open offer, to sell units it holds or to buy (ADR 0081), made in MetaMask. */
export function PostOffer({
  noteId,
  symbol,
  chain,
  prepare,
  done,
}: {
  noteId: string;
  symbol: string;
  chain: ChainParams;
  prepare: (input: Record<string, string>, address: string) => Promise<{ txs?: Array<{ to: string; data: string; label: string }>; error?: string }>;
  done: (tx: string) => Promise<{ status?: string; error?: string }>;
}) {
  const form = useRef<HTMLFormElement>(null);
  const read = () => Object.fromEntries(new FormData(form.current!).entries()) as Record<string, string>;
  return (
    <form ref={form} className="stack" aria-label={`Make an offer on ${symbol}`} onSubmit={(e) => e.preventDefault()}>
      <input type="hidden" name="noteId" value={noteId} />
      <div className="fields">
        <label>
          Offer to
          <select name="side" defaultValue="sell">
            <option value="sell">Sell units I hold</option>
            <option value="buy">Buy units</option>
          </select>
        </label>
        <label>Units<input name="units" type="number" min={1} step={1} defaultValue={1} required /></label>
        <label>Price a unit (€)<input name="price" inputMode="decimal" defaultValue="1000.00" required /></label>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Open to any client the note accepts, for 24 hours. While it is open, units you offer stay in your wallet but are
        locked; the price of an offer to buy is held by the settlement contract. Withdraw it at any time.
      </p>
      <WalletSteps label="Make the offer with MetaMask" chain={chain} prepare={prepare} input={read} done={done} settledSays="Offered: it is listed below." />
    </form>
  );
}
