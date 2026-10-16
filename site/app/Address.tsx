import { loadManifest } from "@/lib/chain/manifest";
import { explorerAddress } from "@/lib/explorer";

/**
 * An address as the site shows it (ADR 0106): its start and end, linked to the chain's explorer
 * (Etherscan on Ethereum Sepolia), the whole address in its tooltip. The middle stays in the text,
 * hidden, so it is still found, read aloud and copied whole.
 */
export function Address({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  let chainId: number | undefined;
  try {
    chainId = loadManifest().chainId;
  } catch {
    chainId = undefined;
  }
  const href = explorerAddress(chainId, value);
  const isAddress = /^0x[0-9a-fA-F]{40}$/.test(value);
  const body = isAddress ? (
    <code className="addr">
      {value.slice(0, 8)}
      <span className="addr-mid">{value.slice(8, -4)}</span>
      {value.slice(-4)}
    </code>
  ) : (
    <code>{value}</code>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" title={`${value} on the explorer`} className="addr-link">{body}</a>
  ) : (
    <span title={value}>{body}</span>
  );
}
