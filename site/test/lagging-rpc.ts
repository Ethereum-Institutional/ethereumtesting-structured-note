/**
 * A JSON-RPC proxy in front of the local node that behaves like a load-balanced public RPC whose
 * nodes are not in step: once it has returned a transaction's receipt, reads at "latest" are
 * answered from the block before for a while, as if by a node that has not seen that block yet.
 *
 * This is what refused a custody account's approvals on Base Sepolia (ERC7943CannotSend right
 * after the registry grant confirmed). The lag is tied to the receipt, not to the clock, so the
 * hazard occurs on every run rather than by chance. Writes, nonces and receipts are passed through
 * unchanged.
 */

import { createServer, type Server } from "node:http";

/** Reads whose block parameter is rewritten, and the position of that parameter. */
const READS: Record<string, number> = { eth_call: 1, eth_estimateGas: 1, eth_getCode: 1, eth_getBalance: 1, eth_getStorageAt: 2 };
// eth_fillTransaction (viem's transaction preparation) has no block parameter; see answer().

export type LaggingRpc = { server: Server; url: string; staleReads: () => number; close: () => Promise<void> };

export async function startLaggingRpc(port: number, upstream: string, lagMs = 1500): Promise<LaggingRpc> {
  let staleUntil = 0;
  let staleBlock = 0n;
  let stale = 0;

  function rewrite(call: any) {
    const at = READS[call?.method];
    if (at === undefined || Date.now() >= staleUntil) return call;
    const params = [...(call.params ?? [])];
    const tag = params[at];
    if (tag !== undefined && tag !== "latest" && tag !== "pending") return call;
    while (params.length < at) params.push(undefined);
    params[at] = `0x${staleBlock.toString(16)}`;
    stale++;
    return { ...call, params };
  }

  // Only the newest receipt moves the lag: a node behind is behind the head, never back in history,
  // so a receipt for an old transaction (the Ledger reads many) changes nothing.
  let newest = 0n;
  function observe(call: any, reply: any) {
    const block = reply?.result?.blockNumber;
    if (call?.method === "eth_getTransactionReceipt" && block && BigInt(block) >= newest) {
      newest = BigInt(block);
      staleBlock = newest - 1n;
      staleUntil = Date.now() + lagMs;
    }
  }

  const post = async (payload: unknown) => {
    const r = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return { status: r.status, text: await r.text() };
  };

  /**
   * One call, as the lagging node answers it. eth_fillTransaction carries no block parameter, so a
   * stale node's answer is emulated: the gas estimate is taken at the stale block first, and its
   * failure, if any, is the answer.
   */
  async function answer(raw: any): Promise<any> {
    if (raw?.method === "eth_fillTransaction" && Date.now() < staleUntil) {
      const probe = JSON.parse((await post({ jsonrpc: "2.0", id: raw.id, method: "eth_estimateGas", params: [raw.params?.[0], `0x${staleBlock.toString(16)}`] })).text);
      stale++;
      if (probe.error) return { jsonrpc: "2.0", id: raw.id, error: probe.error };
    }
    const call = rewrite(raw);
    if (process.env.LAG_DEBUG) console.error("RPC", call?.method, call !== raw ? "stale" : "");
    const reply = JSON.parse((await post(call)).text);
    observe(call, reply);
    return reply;
  }

  const server = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      const reply = Array.isArray(parsed) ? await Promise.all(parsed.map(answer)) : await answer(parsed);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    } catch (e) {
      // Always answer: a proxy that drops a request leaves the client waiting on a timeout.
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `lagging proxy: ${(e as Error).message}` } }));
    }
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    staleReads: () => stale,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
