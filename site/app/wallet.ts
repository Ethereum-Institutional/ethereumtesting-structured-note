import type { ChainParams } from "@/lib/chains";

/**
 * What the browser-wallet components share. The wallet is switched to the pool's chain immediately
 * before anything is signed or sent, adding the chain if it does not know it (EIP-3085): what a
 * wallet reports as its chain need not be the one it signs on (MetaMask's networks per site).
 */
export async function onChain(eth: any, chain: ChainParams): Promise<void> {
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
  } catch (e: any) {
    // 4902: the wallet does not know the chain; adding it also switches to it.
    if (e?.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e;
    await eth.request({ method: "wallet_addEthereumChain", params: [chain] });
  }
  const now = String(await eth.request({ method: "eth_chainId" })).toLowerCase();
  if (now !== chain.chainId) {
    throw new Error(`The wallet is on chain ${parseInt(now, 16)}, not ${chain.chainName} (${parseInt(chain.chainId, 16)}). Switch it to ${chain.chainName} and try again.`);
  }
}

/** Waits for a transaction the wallet sent, through the wallet's own connection. */
export async function confirmed(eth: any, hash: string): Promise<void> {
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

/** Adds a token to the wallet's list on the pool's chain (EIP-747); the wallet asks to confirm. */
export async function watchToken(eth: any, chain: ChainParams, asset: { address: string; symbol: string; decimals: number }): Promise<boolean> {
  await onChain(eth, chain);
  return Boolean(await eth.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address: asset.address, symbol: asset.symbol, decimals: asset.decimals } } }));
}

/** A wallet error in the client's words. */
export function walletError(e: any, chain: ChainParams, fallback: string): string {
  const message = String(e?.message ?? "");
  const wrongChain = message.match(/must match the active chainId "(\d+)"/);
  if (e?.code === 4001) return "You declined in the wallet. Try again when ready.";
  if (wrongChain) return `The wallet acted on chain ${wrongChain[1]}, not ${chain.chainName} (${parseInt(chain.chainId, 16)}). Choose ${chain.chainName} for this site in the wallet, then try again.`;
  return message || fallback;
}
