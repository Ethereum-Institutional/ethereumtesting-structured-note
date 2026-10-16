import "server-only";
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Address, type Chain, type Hex } from "viem";
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

/** Who each capacity is, for messages and the Keys page (ADR 0080). */
export const CAPACITY_LABEL: Record<string, string> = {
  issuer: "Issuer",
  agent: "Agent",
  accessIssuer: "Onboarding agent",
  custodian: "Bank custody platform",
  thirdPartyCustodian: "Third-party custodian",
  depositAgent: "The bank (Deposit Agent)",
  calculationAgent: "Calculation Agent",
  servicing1: "Servicing wallet owner 1",
  servicing2: "Servicing wallet owner 2",
  agentGov1: "Agent governance owner 1",
  agentGov2: "Agent governance owner 2",
  issuerGov1: "Issuer governance owner 1",
  issuerGov2: "Issuer governance owner 2",
  cosigner1: "Co-signer owner 1",
  cosigner2: "Co-signer owner 2",
  investorA: "Investor A",
  investorB: "Investor B",
  investorC: "Investor C",
  investorD: "Investor D",
};
/** Capacities that only sign, and send nothing themselves: they need no ETH. */
export const SIGNS_ONLY = new Set(["servicing1", "servicing2", "agentGov1", "agentGov2", "issuerGov1", "issuerGov2", "cosigner1", "cosigner2"]);

/** Below this a key is low, and every Operator page says so (ADR 0080). */
export const feeBuffer = (env: NodeJS.ProcessEnv = process.env) => parseEther(env.FEE_BUFFER_ETH?.trim() || "0.001");

/** A transaction refused before signing: its key cannot pay twice its estimated fees. */
export class InsufficientFees extends Error {
  readonly capacity: string;
  readonly address: Address;
  readonly balance: bigint;
  readonly needed: bigint;
  constructor(capacity: string, address: Address, balance: bigint, needed: bigint) {
    super(
      `The ${CAPACITY_LABEL[capacity] ?? capacity}'s key ${address} holds ${formatEther(balance)} ETH; this transaction needs about ` +
        `${formatEther(needed)} ETH in fees, with a margin. Top it up under Agent → Keys.`,
    );
    this.capacity = capacity;
    this.address = address;
    this.balance = balance;
    this.needed = needed;
  }
}

/** Gas assumed when a transaction cannot be estimated beforehand (its estimate is the network's). */
const GAS_CEILING = { call: 1_500_000n };

const LOCAL_KEYS: Record<string, Hex> = {
  issuer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  agent: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  investorA: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  investorB: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  investorC: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  investorD: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  custodian: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  accessIssuer: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // account 2
  calculationAgent: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356", // account 7
  depositAgent: "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6", // account 9
  thirdPartyCustodian: "0x224b7eb7449992aac96d631d9677f7bf5888245eef6d6eeda31e62d2f29a83e4", // account 22
  // Two of the three owners of the Agent's servicing wallet: mnemonic indices 19 and 20 (Ceremony).
  servicing1: "0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e",
  servicing2: "0xeaa861a9a01391ed3d587d8a5a84ca56ee277629a8b02c22093a419bf240e65d",
  // Two of the three owners of each institution's governance wallet (ADR 0082): the Agent's
  // (indices 10, 11), the Issuer's (13, 14) and the co-signing institution's (16, 17).
  agentGov1: "0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897",
  agentGov2: "0x701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82",
  issuerGov1: "0x47c99abed3324a2707c28affff1267e45918ec8c3f20b8aa892e8b065d2942dd",
  issuerGov2: "0xc526ee95bf44d8fc405a158bb884d9d1238d99f0612e9f33d006bb0789009aaa",
  cosigner1: "0xea6c44ac03bff858b476bba40716402b03e41b8e97e276d1baec7c37d42484a0",
  cosigner2: "0x689af8efa8c651a91ad287602527f3af2fe9f6501a7ac4b061667b5a93e037fd",
};

export function signers(chain: Chain, rpcUrl: string, env: NodeJS.ProcessEnv = process.env) {
  const local = chain.id === LOCAL_CHAIN_ID;
  // How long a sent transaction is waited for. The local node mines at once; Ethereum Sepolia makes a
  // block every 12 s and a large transaction can wait several, so 25 s gave up on issuances that
  // then landed (ADR 0103).
  const receiptTimeout = local ? 25_000 : 150_000;
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

  /**
   * Refuses before signing when the key cannot pay twice the transaction's estimated fees (ADR 0080).
   * An estimate that fails is left to the transaction itself, with a generous ceiling assumed here.
   */
  async function ensureFees(capacity: string, estimate: () => Promise<bigint>, ceiling: bigint, value = 0n): Promise<void> {
    const address = account(capacity).address;
    const [balance, gas, price] = await Promise.all([
      publicClient.getBalance({ address }),
      estimate().catch(() => ceiling),
      publicClient.estimateFeesPerGas().then((f) => f.maxFeePerGas ?? 0n).catch(() => publicClient.getGasPrice()),
    ]);
    const needed = 2n * gas * price + value;
    if (balance < needed) throw new InsufficientFees(capacity, address, balance, needed);
  }

  /** The network's own refusal for want of fees, said as the precheck would say it. */
  async function feesError(capacity: string, err: unknown): Promise<never> {
    if (/insufficient funds|exceeds allowance \(0\)|exceeds the balance/i.test(String((err as Error)?.message))) {
      const address = account(capacity).address;
      throw new InsufficientFees(capacity, address, await publicClient.getBalance({ address }), 0n);
    }
    throw err;
  }

  async function send(capacity: string, params: Record<string, unknown>): Promise<Hex> {
    return enqueue(capacity, async () => {
      await ensureFees(capacity, () => (publicClient.estimateContractGas as any)({ ...params, account: account(capacity) }), GAS_CEILING.call);
      const attempt = async (): Promise<Hex> => {
        const wallet = createWalletClient({ account: account(capacity), chain, transport: http(rpcUrl) });
        // viem's writeContract generics do not narrow against ABIs assembled at run time.
        const hash = (await (wallet.writeContract as any)({ ...params, account: wallet.account, chain })) as Hex;
        await publicClient.waitForTransactionReceipt({ hash, timeout: receiptTimeout });
        return hash;
      };
      try {
        return await attempt();
      } catch (err) {
        if (!local || !/timed out|timeout/i.test(String((err as Error)?.message))) return feesError(capacity, err);
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

  /** Signs a 32-byte digest as a capacity, with no prefix: a contract's own EIP-712 digest, or a multi-signature wallet's transaction hash. */
  async function signHash(capacity: string, hash: Hex): Promise<Hex> {
    return account(capacity).sign({ hash });
  }

  /** Signs a 32-byte digest as an Ethereum signed message, as an ONCHAINID claim is signed (ADR 0088). */
  async function signMessageHash(capacity: string, hash: Hex): Promise<Hex> {
    return account(capacity).signMessage({ message: { raw: hash } });
  }

  /** Sends ETH from a capacity, for topping up another key (ADR 0080). */
  async function transfer(capacity: string, to: Address, value: bigint): Promise<Hex> {
    return enqueue(capacity, async () => {
      await ensureFees(capacity, () => publicClient.estimateGas({ account: account(capacity), to, value }), 21_000n, value);
      const wallet = createWalletClient({ account: account(capacity), chain, transport: http(rpcUrl) });
      const hash = await wallet.sendTransaction({ account: account(capacity), to, value, chain }).catch((e: unknown) => feesError(capacity, e));
      await publicClient.waitForTransactionReceipt({ hash, timeout: receiptTimeout });
      return hash;
    });
  }

  return {
    publicClient,
    send,
    transfer,
    signTypedData,
    signHash,
    signMessageHash,
    resetNonces,
    address: (capacity: string) => account(capacity).address,
    /** The capacities this deployment holds keys for. */
    capacities: () => Object.keys(keys),
  };
}
