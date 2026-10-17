import { redirect } from "next/navigation";
import { routeLabel } from "@/lib/routes";
import { currentRegistrant, isOperator } from "@/lib/access";
import { explorerAddress, explorerTx } from "@/lib/explorer";
import { readLedger, reconcile, type LedgerView, type RegisterRow } from "@/lib/ledger";
import { loadManifest } from "@/lib/chain/manifest";
import { Bar } from "../Bar";

export const dynamic = "force-dynamic";

/**
 * The Ledger (ADR 0071; S-35): the whole lifecycle as the chain records it, decoded from events
 * and calldata alone, for every approved user. Staff also see the register reconciliation.
 */

const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "");
const short = (h: string) => `${h.slice(0, 10)}…`;
/** Long hex (addresses, hashes) is shortened for reading; the full value is on hover. */
function Arg({ text }: { text: string }) {
  const parts = text.split(/(0x[0-9a-fA-F]{40,})/g);
  return (
    <>
      {parts.map((p, i) => (/^0x[0-9a-fA-F]{40,}$/.test(p) ? <span key={i} title={p} className="mono">{`${p.slice(0, 6)}…${p.slice(-4)}`}</span> : <span key={i}>{p}</span>))}
    </>
  );
}
const units = (v: bigint, decimals: number) => (Number(v) / 10 ** decimals).toLocaleString("en-GB", { maximumFractionDigits: decimals });

export default async function Ledger() {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const staff = isOperator(who.email);
  const m = loadManifest();
  let view: LedgerView | null = null;
  let problem: string | null = null;
  try {
    view = await readLedger();
  } catch (e) {
    problem = (e as Error).message;
  }
  let register: RegisterRow[] | null = null;
  let registerProblem: string | null = null;
  if (staff) {
    try {
      register = await reconcile();
    } catch (e) {
      registerProblem = (e as Error).message;
    }
  }
  const link = (hash: string) => {
    const href = explorerTx(m.chainId, hash);
    return href ? <a href={href} target="_blank" rel="noreferrer">{short(hash)}</a> : short(hash);
  };

  return (
    <div className="wrap">
      <Bar who={who} operator={staff} />
      <header className="masthead" style={{ paddingBottom: "1rem" }}>
        <p className="eyebrow">Evidence</p>
        <h1 style={{ fontSize: "2.5rem" }}>Ledger</h1>
        <p className="lede">
          Everything instructed on-chain, reconstructed from the chain's own events and calldata: no internal system is
          consulted. Every call is named by the contract it went to; nothing unrecognised is dropped.
        </p>
      </header>

      {problem && <p className="notice err">The chain could not be read just now: {problem}</p>}
      {view && (
        <>
          <p className="muted">
            {view.rows.length} most recent calls since block {view.fromBlock.toLocaleString("en-GB")}, read {when(view.readAt)}.
          </p>
          <div className="table-wrap panel">
            <table>
              <thead>
                <tr><th>When</th><th>What</th><th>Contract</th><th>Details</th><th>By</th><th>Transaction</th></tr>
              </thead>
              <tbody>
                {view.rows.map((r, i) => (
                  <tr key={`${r.txHash}-${i}`}>
                    <td style={{ whiteSpace: "nowrap" }}>{when(r.at)}<br /><span className="muted">block {r.block}</span></td>
                    <td>
                      <span className={`pill ${r.tone === "control" ? "revoked" : r.tone === "trade" ? "approved" : r.recognised ? "pending" : ""}`}>{r.recognised ? r.tone : "unrecognised"}</span>{" "}
                      {r.meaning}
                    </td>
                    <td>{r.target}{r.via ? <><br /><span className="muted">through {r.via}</span></> : null}</td>
                    <td style={{ minWidth: "18rem", maxWidth: "30rem" }}>
                      <span className="muted">{r.fn}</span>
                      {r.args.map((a, j) => <span key={j}> · <Arg text={a} /></span>)}
                    </td>
                    <td><Arg text={r.from} /></td>
                    <td>{link(r.txHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {staff && (
        <>
          <h2 id="register">Register reconciliation</h2>
          <p className="muted">
            Staff only. Every wallet the identity storage has held, or the site has onboarded: what the chain says, what the
            site's records say, and where they differ.
          </p>
          {registerProblem && <p className="notice err">{registerProblem}</p>}
          {register && (
            <div className="table-wrap panel">
              <table>
                <thead>
                  <tr><th>Account</th><th>Identity</th><th>Deposit eligible</th><th>Note eligible</th><th>{m.assets.deposit?.symbol}</th><th>Units of the notes</th><th>Client</th><th>Route</th><th>Site status</th><th>Finding</th></tr>
                </thead>
                <tbody>
                  {register.map((r) => {
                    const href = explorerAddress(m.chainId, r.account);
                    return (
                      <tr key={r.account}>
                        <td>
                          {href ? <a href={href} target="_blank" rel="noreferrer"><Arg text={r.account} /></a> : <Arg text={r.account} />}
                          {r.label && <><br /><span className="muted">{r.label}</span></>}
                        </td>
                        <td>{r.onChain.identity ? <Arg text={r.onChain.identity} /> : "—"}</td>
                        <td>{r.onChain.depositEligible ? "yes" : "—"}</td>
                        <td>{r.onChain.noteEligible ? "yes" : "—"}</td>
                        <td>{units(r.onChain.deposit, m.assets.deposit?.decimals ?? 2)}</td>
                        <td style={{ whiteSpace: "normal" }}>{r.onChain.holdings.length ? r.onChain.holdings.map((h) => `${h.units} ${h.symbol}`).join(", ") : "—"}</td>
                        <td>{r.site?.client ?? ""}</td>
                        <td>{routeLabel(r.site?.route)}</td>
                        <td>{r.site?.status ?? ""}</td>
                        <td style={{ whiteSpace: "normal", minWidth: "16rem" }}>
                          {r.finding ? <span className="notice err" style={{ display: "block" }}>{r.finding}</span> : <span className="muted">{r.note ?? "agrees"}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
