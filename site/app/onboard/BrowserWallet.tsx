"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ChainParams } from "@/lib/chains";

type Step = "idle" | "connecting" | "switching" | "preparing" | "signing" | "submitting";
const SAYS: Record<Step, string> = {
  idle: "",
  connecting: "Asking your wallet for its address…",
  switching: "Asking your wallet to switch to the pool's network…",
  preparing: "Asking the bank for the message to sign…",
  signing: "Sign the message in your wallet.",
  submitting: "Sending the signature to the bank…",
};

/**
 * Binds the wallet open in the browser (ADR 0068): reads its address, switches it to the pool's
 * chain (adding the chain if the wallet does not know it), has the bank prepare its message for
 * that address, proposes the message for signature, and submits the signature. One click.
 */
export function BrowserWallet({
  id,
  chain,
  label,
  start,
  finish,
}: {
  id: string;
  chain: ChainParams;
  label: string;
  start: (id: string, address: string) => Promise<{ typedData?: Record<string, unknown>; error?: string }>;
  finish: (id: string, signature: string) => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    const eth = (window as any).ethereum;
    if (!eth) return setError("No browser wallet was found. Install MetaMask, or use another signer below.");
    try {
      setStep("connecting");
      const [address] = await eth.request({ method: "eth_requestAccounts" });
      if (!address) throw new Error("The wallet shared no account.");

      setStep("preparing");
      const prepared = await start(id, address);
      if (prepared.error || !prepared.typedData) throw new Error(prepared.error ?? "The bank prepared no message.");

      // Asked every time, immediately before signing: what a wallet reports as its chain need not
      // be the one it signs on (MetaMask's networks per site), and it may have changed meanwhile.
      setStep("switching");
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
      } catch (e: any) {
        // 4902: the wallet does not know the chain; add it, which also switches to it.
        if (e?.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e;
        await eth.request({ method: "wallet_addEthereumChain", params: [chain] });
      }
      const now = String(await eth.request({ method: "eth_chainId" })).toLowerCase();
      if (now !== chain.chainId) {
        throw new Error(`The wallet is on chain ${parseInt(now, 16)}, not ${chain.chainName} (${parseInt(chain.chainId, 16)}). Switch it to ${chain.chainName} and try again.`);
      }

      setStep("signing");
      const signature = await eth.request({ method: "eth_signTypedData_v4", params: [address, JSON.stringify(prepared.typedData)] });

      setStep("submitting");
      const done = await finish(id, signature);
      if (done.error) throw new Error(done.error);
      setStep("idle");
      router.refresh();
    } catch (e: any) {
      setStep("idle");
      const message = String(e?.message ?? "");
      const wrongChain = message.match(/must match the active chainId "(\d+)"/);
      setError(
        e?.code === 4001 ? "You declined in the wallet. Try again when ready."
        : wrongChain ? `The wallet signed on chain ${wrongChain[1]}, not ${chain.chainName} (${parseInt(chain.chainId, 16)}). Choose ${chain.chainName} for this site in the wallet, then try again.`
        : message || "The wallet did not complete.",
      );
    }
  }

  return (
    <div className="stack">
      <div className="actions">
        <button type="button" onClick={run} disabled={step !== "idle"}>{label}</button>
        {step !== "idle" && <span role="status" className="muted">{SAYS[step]}</span>}
      </div>
      {error && <p role="alert" className="notice err">{error}</p>}
    </div>
  );
}
