import { formatEther } from "viem";
import { explorerAddress } from "@/lib/explorer";
import { keyBalances, TOP_UP } from "@/lib/chain/keys";
import { topUpAction } from "../../actions";
import { ActionForm } from "../ActionForm";
import { Linked, when } from "../parts";

export const dynamic = "force-dynamic";

const eth = (v: bigint) => Number(formatEther(v)).toLocaleString("en-GB", { maximumFractionDigits: 6 });

/** Every key the site signs with, and its ETH for fees (ADR 0080). */
export default async function Keys() {
  const view = await keyBalances(true).catch((e) => (e as Error).message);
  if (typeof view === "string") {
    return (
      <>
        <h2 id="keys">Keys</h2>
        <section className="panel"><p role="alert" className="notice err">The balances could not be read: {view}</p></section>
      </>
    );
  }
  return (
    <>
      <h2 id="keys">Keys</h2>
      <section className="panel">
        <p className="muted">
          The keys the site signs with, on chain {view.chainId}, read {when(view.readAt)}. Before every transaction the site
          checks that its key can pay twice the estimated fees, and refuses otherwise. A key below {eth(view.buffer)} ETH is
          low, and every Operator page says so. A top-up sends {eth(TOP_UP)} ETH from the best-funded key
          {view.funder ? `, now the ${view.funder.label}'s` : ""}.
        </p>
        {view.chainId === 84532 && (
          <p className="muted">
            To refill the funding key: <a href="https://docs.base.org/base-chain/tools/network-faucets" target="_blank" rel="noreferrer">Base Sepolia faucets</a>.
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Key</th><th>Address</th><th>ETH</th><th>Transactions left</th><th>Status</th><th /></tr></thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.capacity}>
                  <td>{r.label}</td>
                  <td><Linked href={explorerAddress(view.chainId, r.address)}>{r.address}</Linked></td>
                  <td>{eth(r.balance)}</td>
                  <td>{r.signsOnly ? "–" : `about ${r.transactionsLeft?.toLocaleString("en-GB")}`}</td>
                  <td>
                    <span className={`pill ${r.state === "ok" ? "approved" : r.state === "signs-only" ? "" : r.state === "low" ? "pending" : "revoked"}`}>
                      {r.state === "signs-only" ? "signs only" : r.state}
                    </span>
                  </td>
                  <td>
                    {!r.signsOnly && r.state !== "ok" && (
                      <ActionForm action={topUpAction} hidden={{ capacity: r.capacity }} label="Top up" working={`Sending ${eth(TOP_UP)} ETH…`} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          The servicing wallet's owners sign its transactions and the Agent sends them, so the owners need no ETH.
        </p>
      </section>
    </>
  );
}
