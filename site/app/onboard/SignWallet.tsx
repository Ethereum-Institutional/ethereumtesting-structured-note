"use client";

import { useRef, useState } from "react";

/**
 * The client's one signature (ADR 0054, route 2): from a browser wallet, or pasted from any other
 * signer (a custody platform, a hardware wallet, a contract wallet's signing tool).
 */
export function SignWallet({
  id,
  address,
  typedData,
  action,
}: {
  id: string;
  address: string;
  typedData: Record<string, unknown>;
  action: (f: FormData) => Promise<void>;
}) {
  const form = useRef<HTMLFormElement>(null);
  const sig = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function withBrowserWallet() {
    setError(null);
    const eth = (window as any).ethereum;
    if (!eth) return setError("No browser wallet was found. Paste a signature below instead.");
    try {
      const [account] = await eth.request({ method: "eth_requestAccounts" });
      if (String(account).toLowerCase() !== address.toLowerCase()) {
        return setError(`The browser wallet is ${account}, not ${address}. Switch account and try again.`);
      }
      sig.current!.value = await eth.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify(typedData)] });
      form.current!.requestSubmit();
    } catch (e) {
      setError((e as Error).message ?? "The wallet did not sign.");
    }
  }

  return (
    <form ref={form} action={action}>
      <input type="hidden" name="id" value={id} />
      <p>
        <button type="button" onClick={withBrowserWallet}>Sign with browser wallet</button>
      </p>
      <label>
        Or paste the signature from another signer
        <input ref={sig} name="signature" placeholder="0x…" pattern="0x[0-9a-fA-F]+" required />
      </label>
      <details>
        <summary className="muted">The message to sign (EIP-712)</summary>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "0.75rem" }}>{JSON.stringify(typedData, null, 1)}</pre>
      </details>
      <p><button type="submit" className="quiet">Submit the pasted signature</button></p>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
