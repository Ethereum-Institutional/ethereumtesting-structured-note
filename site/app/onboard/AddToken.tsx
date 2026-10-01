"use client";

import { useState } from "react";
import type { ChainParams } from "@/lib/chains";
import { watchToken, walletError } from "../wallet";

/** One token's "Add to MetaMask" button (EIP-747). */
export function AddToken({ chain, asset }: { chain: ChainParams; asset: { address: string; symbol: string; decimals: number } }) {
  const [said, setSaid] = useState<string | null>(null);
  async function run() {
    const eth = (window as any).ethereum;
    if (!eth) return setSaid("No browser wallet was found. Install MetaMask first.");
    try {
      setSaid((await watchToken(eth, chain, asset)) ? `${asset.symbol} is in your wallet's list.` : `${asset.symbol} was not added.`);
    } catch (e) {
      setSaid(walletError(e, chain, `${asset.symbol} could not be added.`));
    }
  }
  return (
    <span className="actions">
      <button type="button" className="quiet" onClick={run}>Add {asset.symbol} to MetaMask</button>
      {said && <span role="status" className="muted">{said}</span>}
    </span>
  );
}
