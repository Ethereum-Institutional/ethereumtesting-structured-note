"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChainParams } from "@/lib/chains";
import type { QuoteView } from "../actions";
import { confirmed, ensureWalletFees, onChain, watchToken, walletError } from "../wallet";

type Prepared = { error?: string; approvals?: Array<{ to: string; data: string; label: string }>; swap?: { to: string; data: string }; quote?: QuoteView };

/**
 * Converts in the pool from the client's own wallet: a quote from the pool as the
 * amount is typed; then, in MetaMask, any approvals still missing (once per token, for 30 days)
 * and the swap, with a minimum-received 0.5% below the quote.
 */
export function ConvertPanel({
  wallet,
  chain,
  symbols,
  assets,
  quote,
  prepare,
  done,
}: {
  wallet: string;
  chain: ChainParams;
  symbols: { payment: string; deposit: string };
  /** The two tokens, for adding them to the wallet's list (EIP-747). */
  assets: Array<{ address: string; symbol: string; decimals: number }>;
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
      await onChain(eth, chain);
      setStatus("Checking your wallet holds ETH for the fees…");
      await ensureWalletFees(eth, chain, address, [...(plan.approvals ?? []), plan.swap]);
      for (const [i, a] of (plan.approvals ?? []).entries()) {
        setStatus(`Approval ${i + 1} of ${plan.approvals!.length}: ${a.label}. Confirm in your wallet.`);
        const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from: address, to: a.to, data: a.data }] });
        setStatus(`Approval ${i + 1} of ${plan.approvals!.length}: waiting for it to confirm…`);
        await confirmed(eth, hash);
      }
      setStatus("Confirm the conversion in your wallet.");
      const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from: address, to: plan.swap.to, data: plan.swap.data }] });
      setStatus("Waiting for the conversion to confirm…");
      await confirmed(eth, hash);
      await done(hash, `${plan.quote?.amountIn} ${plan.quote?.paid} into ${plan.quote?.received}`);
      setStatus(`Converted ${plan.quote?.amountIn} ${plan.quote?.paid} into at least ${plan.quote?.minimumOut} ${plan.quote?.received}.`);
      setAmount("");
      router.refresh();
    } catch (e: any) {
      setStatus(null);
      setError(walletError(e, chain, "The conversion did not complete."));
    } finally {
      setBusy(false);
    }
  }

  /** Adds a token to the wallet's list, on the pool's network (EIP-747): the wallet asks the client to confirm. */
  async function watch(asset: { address: string; symbol: string; decimals: number }) {
    setError(null);
    const eth = (window as any).ethereum;
    if (!eth) return setError("No browser wallet was found. Install MetaMask first.");
    try {
      const added = await watchToken(eth, chain, asset);
      setStatus(added ? `${asset.symbol} is in your wallet's list on ${chain.chainName}.` : `${asset.symbol} was not added.`);
    } catch (e: any) {
      setError(walletError(e, chain, `${asset.symbol} could not be added.`));
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
      <div className="actions">
        {assets.map((a) => (
          <button key={a.address} type="button" className="quiet" onClick={() => watch(a)} disabled={busy}>Add {a.symbol} to MetaMask</button>
        ))}
      </div>
      <p className="muted">Converting from {wallet}. The first conversion of each token also asks for two approvals, once.</p>
    </div>
  );
}
