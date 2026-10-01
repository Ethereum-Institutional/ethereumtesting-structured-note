/**
 * What a browser wallet needs to switch to, or add, the pool's chain (EIP-3085). A wallet signs
 * EIP-712 data only on the chain its domain names, so the site asks for that chain first.
 */
export type ChainParams = {
  chainId: `0x${string}`;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls?: string[];
};

const ETH = { name: "Ether", symbol: "ETH", decimals: 18 };

const KNOWN: Record<number, Omit<ChainParams, "chainId">> = {
  84532: { chainName: "Base Sepolia", rpcUrls: ["https://sepolia.base.org"], nativeCurrency: ETH, blockExplorerUrls: ["https://sepolia.basescan.org"] },
  8453: { chainName: "Base", rpcUrls: ["https://mainnet.base.org"], nativeCurrency: ETH, blockExplorerUrls: ["https://basescan.org"] },
  11155111: { chainName: "Sepolia", rpcUrls: ["https://rpc.sepolia.org"], nativeCurrency: ETH, blockExplorerUrls: ["https://sepolia.etherscan.io"] },
  31337: { chainName: "Local node", rpcUrls: ["http://127.0.0.1:8545"], nativeCurrency: ETH },
};

export function chainParams(chainId: number): ChainParams {
  const known = KNOWN[chainId] ?? { chainName: `Chain ${chainId}`, rpcUrls: [], nativeCurrency: ETH };
  return { chainId: `0x${chainId.toString(16)}`, ...known };
}
