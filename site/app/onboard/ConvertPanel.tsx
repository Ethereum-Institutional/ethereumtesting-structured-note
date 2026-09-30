"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChainParams } from "@/lib/chains";
import type { QuoteView } from "../actions";

type Prepared = { error?: string; approvals?: Array<{ to: string; data: string; label: string }>; swap?: { to: string; data: string }; quote?: QuoteView };

/**
 * Converts in the pool from the client's own wallet (ADR 0070): a quote from the pool as the
 * amount is typed; then, in MetaMask, any approvals still missing (once per token, for 30 days)
 * and the swap, with a minimum-received 0.5% below the quote.
 */
export function ConvertPanel({
  wallet,
  chain,
  symbols,
  quote,
  prepare,
  done,
}: {
  wallet: string;
  chain: ChainParams;
  symbols: { payment: string; deposit: string };
  quote: (direction: string, amount: string) => Promise<QuoteView>;
  prepare: (direction: string, amount: string, address: string) => Promise<Prepared>;
  done: (tx: string, summary: string) => Promise<void>;
}) {
  const router = useRouter();
  const [direction, setDirection] = useState("into-deposit");
  const [amount, setAmount] = useState("");
  const [q, setQ] = useState<QuoteView | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQ(null);
    if (!amount.trim()) return;
    const t = setTimeout(async () => setQ(await quote(direction, amount)), 350);
    return () => clearTimeout(t);
  }, [direction, amount, quote]);

  async function receipt(eth: any, hash: string) {
    for (let i = 0; i < 120; i++) {
      const r = await eth.request({ method: "eth_getTransactionReceipt", params: [hash] });
      if (r) {
        if (r.status !== "0x1") throw new Error(`The transaction failed on-chain (${hash}).`);
        return;
      }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    throw new Error(`The transaction was not confirmed in time (${hash}).`);
  }

  async function run() {
    setError(null);
    const eth = (window as any).ethereum;
    if (!eth) return setError("No browser wallet was found. Install MetaMask to convert from your own wallet.");
    setBusy(true);
    try {
      setStatus("Asking your wallet for its address…");
      const [address] = await eth.request({ method: "eth_requestAccounts" });
      setStatus("Preparing the conversion…");
      const plan = await prepare(direction, amount, address);
      if (plan.error || !plan.swap) throw new Error(plan.error ?? "The conversion could not be prepared.");
      setStatus("Asking your wallet to switch to the pool's network…");
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
      } catch (e: any) {
        if (e?.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e;
        await eth.request({ method: "wallet_addEthereumChain", params: [chain] });
      }
      for (const [i, a] of (plan.approvals ?? []).entries()) {
        setStatus(`Approval ${i + 1} of ${plan.approvals!.length}: ${a.label}. Confirm in your wallet.`);
        const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from: address, to: a.to, data: a.data }] });
        setStatus(`Approval ${i + 1} of ${plan.approvals!.length}: waiting for it to confirm…`);
        await receipt(eth, hash);
      }
      setStatus("Confirm the conversion in your wallet.");
      const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from: address, to: plan.swap.to, data: plan.swap.data }] });
      setStatus("Waiting for the conversion to confirm…");
      await receipt(eth, hash);
      await done(hash, `${plan.quote?.amountIn} ${plan.quote?.paid} into ${plan.quote?.received}`);
      setStatus(`Converted ${plan.quote?.amountIn} ${plan.quote?.paid} into at least ${plan.quote?.minimumOut} ${plan.quote?.received}.`);
      setAmount("");
      router.refresh();
    } catch (e: any) {
      setStatus(null);
      setError(e?.code === 4001 ? "You declined in the wallet." : e?.message ?? "The conversion did not complete.");
    } finally {
      setBusy(false);
    }
  }

  const paying = direction === "into-deposit" ? symbols.payment : symbols.deposit;
  return (
    <div className="stack">
      <div className="fields">
        <label>
          Convert
          <select value={direction} onChange={(e) => setDirection(e.target.value)} disabled={busy}>
            <option value="into-deposit">{symbols.payment} into {symbols.deposit}</option>
            <option value="into-payment">{symbols.deposit} into {symbols.payment}</option>
          </select>
        </label>
        <label>
          Amount of {paying}
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="10.00" disabled={busy} />
        </label>
      </div>
      {q?.error && <p className="muted">{q.error}</p>}
      {q && !q.error && (
        <p className="muted" role="note">
          You receive about <strong>{q.amountOut} {q.received}</strong>, and at least {q.minimumOut} {q.received}: the conversion is refused if the pool gives less.
        </p>
      )}
      <div className="actions">
        <button type="button" onClick={run} disabled={busy || !q || Boolean(q.error)}>Convert with MetaMask</button>
        {status && <span role="status" className="muted">{status}</span>}
      </div>
      {error && <p role="alert" className="notice err">{error}</p>}
      <p className="muted">Converting from {wallet}. The first conversion of each token also asks for two approvals, once.</p>
    </div>
  );
}
