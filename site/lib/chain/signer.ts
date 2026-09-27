import "server-only";
import { createPublicClient, createWalletClient, http, type Chain, type Hex } from "viem";
import { createNonceManager, privateKeyToAccount } from "viem/accounts";
import { jsonRpc } from "viem/nonce";
import { signerQueues } from "./queue.ts";

/**
 * Signing for the operations console, by capacity.
 *
 * Keys come from SIGNER_KEYS, a JSON object of capacity to private key. On the local chain
 * alone, the node's published test keys are the default, so a local run needs no setup. On any
 * other chain a missing key is an error, never a fallback to a published key.
 *
 * Every transaction waits for its receipt inside its signer's queue (see queue.ts). On the local
 * chain, a receipt that never arrives is almost always a transaction above a nonce gap left by a
 * state revert; the transaction pool is then cleared, the nonce state rebuilt from the chain,
 * and the transaction sent once more. Clearing the pool is a local node method and is never
 * attempted elsewhere.
 */

export const LOCAL_CHAIN_ID = 31337;

const LOCAL_KEYS: Record<string, Hex> = {
  issuer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  agent: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  investorA: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  investorB: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  investorC: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  investorD: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  custodian: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
};

export function signers(chain: Chain, rpcUrl: string, env: NodeJS.ProcessEnv = process.env) {
  const local = chain.id === LOCAL_CHAIN_ID;
  const configured = env.SIGNER_KEYS ? (JSON.parse(env.SIGNER_KEYS) as Record<string, Hex>) : {};
  const keys = local ? { ...LOCAL_KEYS, ...configured } : configured;

  // Polled every second, not viem's default four: Base mines every two seconds, and an admission waits on several receipts.
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: 1_000 });
  let nonceManager = createNonceManager({ source: jsonRpc() });
  const accounts = new Map<string, ReturnType<typeof privateKeyToAccount>>();
  const enqueue = signerQueues<string>();

  function account(capacity: string) {
    let a = accounts.get(capacity);
    if (!a) {
      const key = keys[capacity];
      if (!key) throw new Error(`no signing key for ${capacity} on chain ${chain.id}`);
      a = privateKeyToAccount(key, { nonceManager });
      accounts.set(capacity, a);
    }
    return a;
  }

  /** Discards nonce state. Needed after a local state revert, which rolls nonces back. */
  function resetNonces() {
    nonceManager = createNonceManager({ source: jsonRpc() });
    accounts.clear();
  }

  async function send(capacity: string, params: Record<string, unknown>): Promise<Hex> {
    return enqueue(capacity, async () => {
      const attempt = async (): Promise<Hex> => {
        const wallet = createWalletClient({ account: account(capacity), chain, transport: http(rpcUrl) });
        // viem's writeContract generics do not narrow against ABIs assembled at run time.
        const hash = (await (wallet.writeContract as any)({ ...params, account: wallet.account, chain })) as Hex;
        await publicClient.waitForTransactionReceipt({ hash, timeout: 25_000 });
        return hash;
      };
      try {
        return await attempt();
      } catch (err) {
        if (!local || !/timed out|timeout/i.test(String((err as Error)?.message))) throw err;
        await publicClient.request({ method: "anvil_dropAllTransactions" as any, params: [] as any });
        resetNonces();
        return attempt();
      }
    });
  }

  /** Signs EIP-712 typed data as a capacity, for a message the capacity attests off-chain. */
  async function signTypedData(capacity: string, typedData: Record<string, any>): Promise<Hex> {
    const { EIP712Domain: _domainTypes, ...types } = typedData.types ?? {};
    return account(capacity).signTypedData({ domain: typedData.domain, types, primaryType: typedData.primaryType, message: typedData.message });
  }

  return { publicClient, send, signTypedData, resetNonces, address: (capacity: string) => account(capacity).address };
}
