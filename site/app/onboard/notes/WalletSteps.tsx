"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ChainParams } from "@/lib/chains";
import { confirmed, ensureWalletFees, onChain, walletError } from "../../wallet";

type Plan = { txs?: Array<{ to: string; data: string; label: string }>; error?: string };

/**
 * Sends, from the client's own wallet, the transactions the site prepared for one act:
 * accepting or taking an offer, making one, or withdrawing it. The wallet is switched to the
 * pool's chain and checked for its fees first; each transaction waits for its receipt.
 */
export function WalletSteps({
  label,
  chain,
  prepare,
  done,
  quiet,
  input,
  settledSays = "Done.",
}: {
  label: string;
  chain: ChainParams;
  prepare: (...args: any[]) => Promise<Plan>;
  done: (tx: string) => Promise<{ status?: string; error?: string }>;
  quiet?: boolean;
  /** For a form: read when clicked, and passed to `prepare` before the address. */
  input?: () => Record<string, string>;
  settledSays?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setError(null);
    const eth = (window as any).ethereum;
    if (!eth) return setError("No browser wallet was found. Install MetaMask to act from your own wallet.");
    setBusy(true);
    try {
      setStatus("Asking your wallet for its address…");
      const [address] = await eth.request({ method: "eth_requestAccounts" });
      setStatus("Preparing…");
      const plan = input ? await prepare(input(), address) : await prepare(address);
      if (plan.error || !plan.txs?.length) throw new Error(plan.error ?? "Nothing was prepared.");
      setStatus("Asking your wallet to switch to the pool's network…");
      await onChain(eth, chain);
      setStatus("Checking your wallet holds ETH for the fees…");
      await ensureWalletFees(eth, chain, address, plan.txs);
      let last = "";
      for (const [i, t] of plan.txs.entries()) {
        setStatus(`Step ${i + 1} of ${plan.txs.length}: ${t.label}. Confirm in your wallet.`);
        last = await eth.request({ method: "eth_sendTransaction", params: [{ from: address, to: t.to, data: t.data }] });
        setStatus(`Step ${i + 1} of ${plan.txs.length}: waiting for it to confirm…`);
        await confirmed(eth, last);
      }
      setStatus("Recording…");
      const r = await done(last);
      if (r.error) throw new Error(r.error);
      setStatus(r.status === "offered" ? "Sent; not visible yet. This page updates shortly." : settledSays);
      router.refresh();
    } catch (e: any) {
      setStatus(null);
      setError(walletError(e, chain, "The wallet did not complete."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="actions">
        <button type="button" className={quiet ? "quiet" : undefined} onClick={run} disabled={busy}>{label}</button>
        {status && <span role="status" className="muted">{status}</span>}
      </div>
      {error && <p role="alert" className="notice err">{error}</p>}
    </div>
  );
}
