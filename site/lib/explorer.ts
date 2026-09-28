/** Where a chain's transactions and addresses can be looked up. None for the local node. */
const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  8453: "https://basescan.org",
  84532: "https://sepolia.basescan.org",
};

export function explorerTx(chainId: number | undefined, hash: string): string | null {
  const base = chainId ? EXPLORERS[chainId] : undefined;
  return base && /^0x[0-9a-fA-F]{64}$/.test(hash) ? `${base}/tx/${hash}` : null;
}

export function explorerAddress(chainId: number | undefined, address: string): string | null {
  const base = chainId ? EXPLORERS[chainId] : undefined;
  return base && /^0x[0-9a-fA-F]{40}$/.test(address) ? `${base}/address/${address}` : null;
}
