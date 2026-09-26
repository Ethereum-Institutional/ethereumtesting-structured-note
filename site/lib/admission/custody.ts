import "server-only";
import { defineChain, maxUint160, maxUint256, maxUint48, parseAbi, encodeFunctionData, type Address, type Hex } from "viem";
import { loadManifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";

/**
 * The custodian's part in a custodied admission (ADR 0054): a segregated custody account for the
 * client, its signature on the wallet-control message (EIP-1271, by the custodian's key), and,
 * once admitted, the approvals that let the custodian trade for it in one step.
 */

const FACTORY = parseAbi([
  "function createAccount(string clientRef) returns (address)",
  "function predictAddress(string clientRef) view returns (address)",
]);
const ACCOUNT = parseAbi(["function execute((address target, uint256 value, bytes data)[] calls) returns (bytes[])"]);
const ERC20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const PERMIT2 = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);

function context() {
  const m = loadManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  if (!m.custody?.factory) throw new Error("the manifest has no custody factory");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, s: signers(chain, rpc), factory: m.custody.factory };
}

/** Opens the client's account, or returns it if it is open already. */
export async function openCustodyAccount(clientRef: string): Promise<Address> {
  const { s, factory } = context();
  const predicted = await s.publicClient.readContract({ address: factory, abi: FACTORY, functionName: "predictAddress", args: [clientRef] });
  const code = await s.publicClient.getCode({ address: predicted });
  if (!code || code === "0x") {
    await s.send("custodian", { address: factory, abi: FACTORY, functionName: "createAccount", args: [clientRef] });
  }
  return predicted;
}

/** The custody account's signature: the custodian signs, and the account answers EIP-1271. */
export function signAsCustodyAccount(typedData: Record<string, any>): Promise<Hex> {
  return context().s.signTypedData("custodian", typedData);
}

/** The approvals a custodied account needs to convert through the pool, in one transaction. */
export async function readyToTrade(account: Address): Promise<Hex> {
  const { m, s } = context();
  const permit2 = m.venue.permit2;
  const tokens = [m.assets.deposit?.address, m.assets.paymentToken?.address].filter(Boolean) as Address[];
  const calls: Array<{ target: Address; value: bigint; data: Hex }> = [];
  for (const token of tokens) {
    calls.push({ target: token, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [permit2, maxUint256] }) });
    for (const spender of [m.venue.router, m.venue.positionManager]) {
      calls.push({ target: permit2, value: 0n, data: encodeFunctionData({ abi: PERMIT2, functionName: "approve", args: [token, spender, maxUint160, Number(maxUint48)] }) });
    }
  }
  return s.send("custodian", { address: account, abi: ACCOUNT, functionName: "execute", args: [calls] });
}
