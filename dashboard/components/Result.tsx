"use client";
import type { ChainReceipt } from "@/app/actions";
import { short } from "./ui";

/**
 * Outcome box for any action, plus — when the action provides one — the on-chain receipt:
 * the contract that was called, the exact Solidity call, the mined transaction, and the state
 * read back from the chain afterwards. The receipt is what turns "I clicked a toggle" into
 * "I changed a public ledger and here is the proof".
 */
export function Result({
  result,
}: {
  result: { ok: boolean; message: string; chain?: ChainReceipt } | null;
}) {
  if (!result) return null;
  return (
    <div className="mt-3 space-y-2">
      <div
        className="rounded border px-3 py-2 text-xs leading-relaxed"
        style={{
          borderColor: result.ok ? "rgba(13,138,95,.35)" : "rgba(255,107,107,.35)",
          background: result.ok ? "rgba(13,138,95,.05)" : "rgba(255,107,107,.08)",
          color: result.ok ? "var(--ok)" : "var(--bad)",
        }}
      >
        {result.message}
      </div>
      {result.chain && (
        <div
          className="overflow-x-auto rounded border px-3 py-2 font-mono text-[10px] leading-relaxed"
          style={{ borderColor: "var(--line)", background: "var(--panel-2)", color: "var(--muted)" }}
        >
          <div>
            <span style={{ color: "var(--text)" }}>{result.chain.contract}</span>
            {" at "}
            <span title={result.chain.address}>{short(result.chain.address)}</span>
          </div>
          <div className="whitespace-nowrap">
            <span style={{ color: "var(--accent)" }}>{result.chain.fn}</span>(
            {result.chain.args.join(", ")})
          </div>
          {result.chain.txHash && (
            <div>
              tx <span title={result.chain.txHash}>{result.chain.txHash.slice(0, 14)}…</span>
              {typeof result.chain.block === "number" && <> · mined in block {result.chain.block}</>}
            </div>
          )}
          {result.chain.readback && (
            <div style={{ color: "var(--ok)" }}>read back from chain: {result.chain.readback}</div>
          )}
        </div>
      )}
    </div>
  );
}
