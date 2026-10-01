import { getStore } from "@/lib/store";
import { explorerAddress, explorerTx } from "@/lib/explorer";
import { tokens } from "@/lib/pool/convert";
import { advanceAdmissionAction, decideAdmissionAction, finishCustodiedAction } from "../../actions";
import { AnchorWatch } from "../../AnchorWatch";
import { PendingButton } from "../../PendingButton";
import { AdmittedActions, Linked, when } from "../parts";

export const dynamic = "force-dynamic";

export default async function Admissions() {
  const store = getStore();
  const admissions = await store.listAdmissions(30);
  const t = tokens();
  const symbols = { payment: t.payment.symbol, deposit: t.deposit.symbol };
  // How many admitted wallets rest on each corporate identity: what revoking it would withdraw.
  const resting = new Map<string, number>();
  for (const x of await store.listAdmissions(500)) {
    const cid = (x.data as Record<string, any>).assessment?.attestation?.primaryCredential?.toLowerCase();
    if (x.status === "admitted" && cid) resting.set(cid, (resting.get(cid) ?? 0) + 1);
  }
  return (
    <>
      <h2 id="admissions">Admissions</h2>
      <AnchorWatch ids={admissions.filter((a) => a.status === "awaiting-anchor").map((a) => a.id)} advance={advanceAdmissionAction} />
      <div className="table-wrap panel">
        <table style={{ whiteSpace: "nowrap" }}>
          <thead>
            <tr>
              <th>Started</th><th>Route</th><th>Status</th><th>Corporation</th><th>Officer</th><th>Wallet</th>
              <th>Wallet type</th><th>Jurisdiction</th><th>Class</th><th>Pool grant to</th><th>Pool grant</th>
              <th>Registry grant</th><th>Trading approvals</th><th>Anchored</th><th>Problem</th><th />
            </tr>
          </thead>
          <tbody>
            {admissions.map((a) => {
              const d = a.data as Record<string, any>;
              const s = d.assessment?.ok ? d.assessment.summary : null;
              const w = d.written as { chainId?: number; poolGrantTx?: string; registryGrantTx?: string; readyTx?: string; poolGrantExpiresAt?: number } | undefined;
              const revokedAtBank = ((d.bankRevocations ?? []) as Array<{ which: string; by: string; reason: string }>)
                .map((r) => `${r.which === "wallet" ? "Wallet credential" : "Corporate identity"} revoked at the bank by ${r.by}: ${r.reason}.`)
                .join(" ");
              const problem =
                a.status === "offboarded"
                  ? `Offboarded by ${d.offboarded?.by} on ${when(d.offboarded?.at ?? null)}: ${d.offboarded?.reason} ${revokedAtBank}`
                  : revokedAtBank && a.status === "admitted"
                  ? `${revokedAtBank} Offboard it to remove its grants now; otherwise anyone can void its pool grant once the revocation is on-chain.`
                  : a.status === "awaiting-anchor"
                  ? `Waiting for the bank to anchor ${d.anchoring?.pending?.length ?? "its"} credential${d.anchoring?.pending?.length === 1 ? "" : "s"} (since ${when(d.anchorSince ?? a.createdAt).slice(11)}); usually about a minute.`
                  : d.assessment && !d.assessment.ok ? d.assessment.problems.join(" ") : w ? "" : d.error ?? "";
              const anchorTxs = [...new Set(((d.anchors ?? []) as Array<{ anchorTx: string }>).map((x) => x.anchorTx))];
              const tx = (hash: string | undefined) =>
                hash ? <Linked href={explorerTx(w?.chainId, hash)}>{`${hash.slice(0, 10)}…`}</Linked> : "";
              return (
                <tr key={a.id}>
                  <td>{when(a.createdAt)}</td>
                  <td>{a.route}</td>
                  <td><span className={`pill ${a.status === "ready" || a.status === "awaiting-anchor" ? "pending" : a.status === "admitted" ? "approved" : a.status === "offboarded" ? "revoked" : ""}`}>{a.status}</span></td>
                  <td>{s?.corporation ?? d.record?.legalName ?? ""}</td>
                  <td>{s?.officerDid ? `${s.role}, ${s.officerDid}` : ""}</td>
                  <td>{s ? <Linked href={explorerAddress(w?.chainId, s.wallet)}>{s.wallet}</Linked> : d.account ? <Linked href={explorerAddress(w?.chainId, d.account)}>{d.account}</Linked> : d.request?.walletAddress ?? ""}</td>
                  <td>{s?.walletType ?? d.request?.addressType ?? ""}</td>
                  <td>{s?.jurisdiction ?? d.record?.jurisdiction ?? ""}</td>
                  <td>{s?.investorClass ?? ""}</td>
                  <td>{w?.poolGrantExpiresAt ? when(new Date(w.poolGrantExpiresAt * 1000).toISOString()) : ""}</td>
                  <td>{tx(w?.poolGrantTx)}</td>
                  <td>{tx(w?.registryGrantTx)}</td>
                  <td>{tx(w?.readyTx)}</td>
                  <td>{anchorTxs.map((h) => <span key={h}>{tx(h)} </span>)}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 280 }}>{problem}</td>
                  <td>
                    {a.route === "custodied" && a.status === "failed" && d.clientRef && (
                      <form action={finishCustodiedAction} className="actions">
                        <input type="hidden" name="id" value={a.id} />
                        <PendingButton className="quiet" working="Setting the trading approvals…">Set trading approvals</PendingButton>
                      </form>
                    )}
                    {a.status === "admitted" && (
                      <AdmittedActions
                        id={a.id}
                        affected={resting.get(String(d.assessment?.attestation?.primaryCredential ?? "").toLowerCase()) ?? 1}
                        custodied={a.route === "custodied"}
                        symbols={symbols}
                        notes={[
                          ...((d.credits ?? []) as Array<{ amount: string; bookingRef: string }>).slice(-1).map((c) => `Last credit: ${c.amount} ${symbols.deposit}, ${c.bookingRef}`),
                          ...((d.conversions ?? []) as Array<{ summary: string }>).slice(-1).map((c) => `Last conversion: ${c.summary}`),
                        ]}
                      />
                    )}
                    {a.status === "offboarded" && (
                      <span className="muted">{tx(d.offboarded?.poolRevokeTx)} {tx(d.offboarded?.registryRevokeTx)}</span>
                    )}
                    {a.status === "ready" && (
                      <div className="actions">
                        <form action={decideAdmissionAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="decision" value="approve" />
                          <PendingButton className="quiet" working="Writing both grants: up to a minute.">Approve and write grants</PendingButton>
                        </form>
                        <form action={decideAdmissionAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="decision" value="decline" />
                          <button type="submit" className="quiet">Decline</button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
