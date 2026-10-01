"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ChainParams } from "@/lib/chains";
import { confirmed, onChain, walletError } from "../../wallet";

type Tx = { to: string; data: string; label: string };

/**
 * Accepts the Issuer's offer from the client's own wallet (ADR 0075): the site prepares the two
 * transactions for the connected address, the price's allowance and the acceptance; MetaMask
 * sends each; the units and the price move in the second, or neither does.
 */
export function AcceptOffer({
  noteId,
  tradeId,
  chain,
  prepare,
  done,
}: {
  noteId: string;
  tradeId: string;
  chain: ChainParams;
  prepare: (noteId: string, tradeId: string, address: string) => Promise<{ txs?: Tx[]; error?: string }>;
  done: (noteId: string, tradeId: string, tx: string) => Promise<{ status?: string; error?: string }>;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setError(null);
    const eth = (window as any).ethereum;
    if (!eth) return setError("No browser wallet was found. Install MetaMask to accept from your own wallet.");
    setBusy(true);
    try {
      setStatus("Asking your wallet for its address…");
      const [address] = await eth.request({ method: "eth_requestAccounts" });
      setStatus("Preparing the acceptance…");
      const plan = await prepare(noteId, tradeId, address);
      if (plan.error || !plan.txs?.length) throw new Error(plan.error ?? "The acceptance could not be prepared.");
      setStatus("Asking your wallet to switch to the pool's network…");
      await onChain(eth, chain);
      let last = "";
      for (const [i, t] of plan.txs.entries()) {
        setStatus(`Step ${i + 1} of ${plan.txs.length}: ${t.label}. Confirm in your wallet.`);
        last = await eth.request({ method: "eth_sendTransaction", params: [{ from: address, to: t.to, data: t.data }] });
        setStatus(`Step ${i + 1} of ${plan.txs.length}: waiting for it to confirm…`);
        await confirmed(eth, last);
      }
      setStatus("Confirming the settlement…");
      const r = await done(noteId, tradeId, last);
      if (r.error) throw new Error(r.error);
      setStatus(r.status === "settled" ? "Settled: the units are in your wallet." : "Sent; the settlement is not visible yet. This page updates shortly.");
      router.refresh();
    } catch (e: any) {
      setStatus(null);
      setError(walletError(e, chain, "The acceptance did not complete."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="actions">
        <button type="button" onClick={run} disabled={busy}>Accept with MetaMask</button>
        {status && <span role="status" className="muted">{status}</span>}
      </div>
      {error && <p role="alert" className="notice err">{error}</p>}
    </div>
  );
}
