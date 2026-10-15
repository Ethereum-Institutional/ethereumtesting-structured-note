import "server-only";
import { concat, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import type { signers } from "./signer.ts";
import { until } from "./until.ts";

/**
 * Acting through one of the deployment's multi-signature wallets (Safe 1.4.1, ADRs 0016, 0072).
 * Two owners whose keys the site holds sign the wallet's own transaction hash, and an ordinary key
 * sends it, so the wallet acts exactly as it would on its owners' signatures from their devices.
 */

const SAFE = parseAbi([
  "function nonce() view returns (uint256)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
]);

type Signers = ReturnType<typeof signers>;

/**
 * Has `wallet` call `to` with `data`, signed by `owners` (capacities whose keys the site holds) and
 * sent by `sender`. Returns the transaction hash once it is mined and the wallet's new nonce reads back.
 */
export async function execThroughWallet(s: Signers, wallet: Address, owners: string[], sender: string, to: Address, data: Hex): Promise<Hex> {
  const [nonce, threshold, onChain] = await Promise.all([
    s.publicClient.readContract({ address: wallet, abi: SAFE, functionName: "nonce" }),
    s.publicClient.readContract({ address: wallet, abi: SAFE, functionName: "getThreshold" }),
    s.publicClient.readContract({ address: wallet, abi: SAFE, functionName: "getOwners" }),
  ]);
  const listed = new Set(onChain.map((a) => a.toLowerCase()));
  const signing = owners.map((c) => ({ capacity: c, address: s.address(c) })).filter((o) => listed.has(o.address.toLowerCase()));
  if (BigInt(signing.length) < threshold) throw new Error(`the wallet ${wallet} needs ${threshold} owners' signatures; the site holds ${signing.length}`);
  const hash = await s.publicClient.readContract({
    address: wallet,
    abi: SAFE,
    functionName: "getTransactionHash",
    args: [to, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, nonce],
  });
  // Signatures in ascending order of owner, as the wallet requires.
  signing.sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
  const signatures = concat(await Promise.all(signing.slice(0, Number(threshold)).map((o) => s.signHash(o.capacity, hash))));
  const tx = await s.send(sender, {
    address: wallet,
    abi: SAFE,
    functionName: "execTransaction",
    args: [to, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signatures],
  });
  // The wallet's next act signs over its next nonce: wait until reads show this one used, or a
  // node a block behind would hand the next act the same nonce, and the wallet refuse it (GS026).
  await until(() => s.publicClient.readContract({ address: wallet, abi: SAFE, functionName: "nonce" }), (n) => n > nonce);
  return tx;
}
