"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { inspectPassport, forgeClaim, type PassportView, type ForgeResult } from "@/app/claim-actions";
import { short } from "./ui";

/**
 * Click a passport hash or claim stamp → a modal built as two flat lists and nothing else:
 * the passport exactly as it sits on chain, then every check the market runs on it — each
 * check one named contract call with its live answer. A forgery button at the end changes one
 * character and re-asks the issuer, so the audience watches a fake fail.
 *
 * Deliberately banker-simple: no cryptography walkthrough, no tabs, no long paragraphs. The
 * list of calls IS the explanation.
 */

/* ------------------------------------------------------------------ trigger */

export function ClaimTrigger({
  wallet,
  identity,
  topics,
  title,
  className,
  style,
  children,
}: {
  /** The holder's wallet / custody account the market checks. */
  wallet: string;
  /** The ONCHAINID passport contract. */
  identity: string;
  /** Claim topics present — gates clickability only. */
  topics: number[];
  title?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (topics.length === 0 || !wallet) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title ?? "Open this passport — see everything the market checks, live"}
        className={`cursor-pointer rounded text-left transition-opacity hover:opacity-70 ${className ?? ""}`}
        style={style}
      >
        {children}
      </button>
      {open && <PassportModal wallet={wallet} identity={identity} onClose={() => setOpen(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ staging */

/** Reveals N rows one at a time, so the audience reads each check as it "happens". */
function useStagedReveal() {
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const start = (total: number) => {
    stop();
    let n = 1;
    setCount(1);
    timer.current = setInterval(() => {
      n += 1;
      setCount(n);
      if (n >= total) stop();
    }, 450);
  };
  useEffect(() => stop, []);
  return { count, start };
}

/* -------------------------------------------------------------------- modal */

function PassportModal({ wallet, identity, onClose }: { wallet: string; identity: string; onClose: () => void }) {
  const [view, setView] = useState<PassportView | null>(null);
  const [forged, setForged] = useState<ForgeResult | null>(null);
  const [forging, setForging] = useState(false);
  const [, startTransition] = useTransition();
  const reveal = useStagedReveal();

  useEffect(() => {
    startTransition(async () => {
      setView(await inspectPassport(wallet as `0x${string}`, identity as `0x${string}`));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, identity]);

  useEffect(() => {
    // Capture phase, so Escape closes only the modal and never reaches the demo guide's own
    // Escape handler (which would exit the presenter script mid-pitch).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const ok = view && view.ok === true ? view : null;
  const totalRows = ok ? ok.checks.length + 1 : 0; // +1 for the verdict banner

  function runForgery() {
    if (!ok) return;
    setForging(true);
    const topic = ok.claims[0]?.topic ?? 7;
    startTransition(async () => {
      setForged(await forgeClaim(identity as `0x${string}`, topic));
      setForging(false);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(24,24,46,.5)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-xl overflow-y-auto rounded-lg border"
        style={{ background: "var(--panel)", borderColor: "var(--line-strong)", maxHeight: "88vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b px-5 py-4"
          style={{ background: "var(--panel)", borderColor: "var(--line)" }}
        >
          <div>
            <h2 className="text-[13px] font-semibold uppercase tracking-wider">Inside the on-chain passport</h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
              The credential as it sits on chain — and every check the market runs on it
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-2 py-0.5 text-xs transition-opacity hover:opacity-70"
            style={{ borderColor: "var(--line)", color: "var(--muted)" }}
          >
            close
          </button>
        </header>

        <div className="space-y-5 px-5 py-4">
          {!view && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Reading the passport from the chain…
            </p>
          )}
          {view && view.ok === false && (
            <p className="text-xs" style={{ color: "var(--bad)" }}>
              {view.message}
            </p>
          )}

          {ok && (
            <>
              {/* 1 — the passport, as a flat list */}
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider">The passport</h3>
                <dl className="mt-2 space-y-1.5 text-xs">
                  <Field label="Passport contract" value={<Mono full={ok.identity} />} />
                  <Field label="Bound wallet" value={<Mono full={ok.wallet} />} />
                  <Field label="Country" value={`${ok.countryName} (code ${ok.countryCode})`} />
                  {ok.claims.map((c) => (
                    <Field
                      key={c.topic}
                      label={`Claim — ${c.label}`}
                      value={
                        <span>
                          topic {c.topic} · sealed by <Mono full={c.issuer} />
                          <span className="mt-0.5 block font-mono text-[11px]" style={{ color: "var(--muted)" }}>
                            &ldquo;{c.note}&rdquo;
                          </span>
                        </span>
                      }
                    />
                  ))}
                </dl>
                <p className="mt-2.5 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  That is the entire record — no documents, no personal data. Each seal is the KYC
                  provider&apos;s signature over passport + topic + note.
                </p>
              </section>

              {/* 2 — the checklist */}
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider">
                  Every check the market runs
                </h3>
                <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
                  One contract call per item — the same calls the pool makes inside every order.
                </p>
                {reveal.count === 0 ? (
                  <button
                    type="button"
                    onClick={() => reveal.start(totalRows)}
                    className="mt-2 rounded border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide transition-opacity hover:opacity-80"
                    style={{ borderColor: "rgba(78,94,228,.45)", color: "var(--accent)" }}
                  >
                    Run all checks — live →
                  </button>
                ) : (
                  <>
                    <ul className="mt-2 space-y-1">
                      {ok.checks.slice(0, reveal.count).map((c) => (
                        <CheckRow key={c.label} check={c} />
                      ))}
                    </ul>
                    {reveal.count > ok.checks.length && (
                      <p
                        className="mt-2 rounded border px-3 py-2 text-xs font-semibold"
                        style={
                          ok.allPass
                            ? { borderColor: "rgba(13,138,95,.5)", background: "rgba(13,138,95,.06)", color: "var(--ok)" }
                            : { borderColor: "rgba(207,63,51,.5)", background: "rgba(207,63,51,.06)", color: "var(--bad)" }
                        }
                      >
                        {ok.allPass
                          ? "✓ ALL CHECKS PASS — the pool settles this holder's orders"
                          : `✗ THE POOL REFUSES — ${ok.failReason?.toLowerCase()}`}
                      </p>
                    )}
                  </>
                )}
              </section>

              {/* 3 — the forgery */}
              {reveal.count > ok.checks.length && ok.claims.length > 0 && (
                <section>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider">Try to forge it</h3>
                  {!forged ? (
                    <button
                      type="button"
                      onClick={runForgery}
                      disabled={forging}
                      className="mt-2 rounded border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide transition-opacity hover:opacity-80 disabled:opacity-40"
                      style={{ borderColor: "rgba(207,63,51,.45)", color: "var(--bad)" }}
                    >
                      {forging ? "forging…" : `Change one character of the ${ok.claims[0].label} note →`}
                    </button>
                  ) : forged.ok === false ? (
                    <p className="mt-2 text-xs" style={{ color: "var(--bad)" }}>
                      {forged.message}
                    </p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      <ForgedNote original={forged.originalNote} forged={forged.forgedNote} />
                      <div
                        className="rounded border px-3 py-2"
                        style={{ borderColor: "rgba(207,63,51,.5)", background: "rgba(207,63,51,.06)" }}
                      >
                        <div className="flex items-baseline gap-2 text-xs">
                          <span style={{ color: "var(--bad)" }}>✗</span>
                          <span className="font-mono text-[11px] break-all">{forged.call}</span>
                        </div>
                      </div>
                      <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
                        One character changed and the seal no longer points at the KYC provider
                        {forged.recovered && (
                          <>
                            {" "}
                            — it recovers to <span className="font-mono">{short(forged.recovered)}</span>, a stranger
                          </>
                        )}
                        . A forged passport fails the mathematics, at every venue, automatically.
                      </p>
                    </div>
                  )}
                </section>
              )}

              <footer
                className="border-t pt-3 text-[10px] leading-relaxed"
                style={{ borderColor: "var(--line)", color: "var(--muted)" }}
              >
                Every value above is a live public chain read — not a row in this app&apos;s database.
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- fragments */

function CheckRow({ check }: { check: { label: string; call: string; state: "pass" | "fail" | "info" } }) {
  const mark = check.state === "pass" ? "✓" : check.state === "fail" ? "✗" : "·";
  const color = check.state === "pass" ? "var(--ok)" : check.state === "fail" ? "var(--bad)" : "var(--muted)";
  return (
    <li className="rounded border px-3 py-1.5" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-baseline gap-2 text-xs">
        <span style={{ color }}>{mark}</span>
        <span className={check.state === "info" ? "" : "font-medium"} style={check.state === "info" ? { color: "var(--muted)" } : undefined}>
          {check.label}
        </span>
      </div>
      <div className="mt-0.5 pl-4 font-mono text-[11px] break-all" style={{ color: "var(--muted)" }}>
        {check.call}
      </div>
    </li>
  );
}

function ForgedNote({ original, forged }: { original: string; forged: string }) {
  let i = 0;
  while (i < original.length && i < forged.length && original[i] === forged[i]) i++;
  return (
    <code
      className="block break-all rounded border px-2 py-1.5 font-mono text-[11px]"
      style={{ borderColor: "rgba(207,63,51,.4)", background: "rgba(207,63,51,.04)" }}
    >
      {forged.slice(0, i)}
      <mark className="rounded px-0.5" style={{ background: "rgba(207,63,51,.25)", color: "var(--bad)" }}>
        {forged.slice(i)}
      </mark>
      <span className="ml-2 text-[10px]" style={{ color: "var(--muted)" }}>
        (was &ldquo;{original.slice(i)}&rdquo;)
      </span>
    </code>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0" style={{ color: "var(--muted)" }}>
        {label}
      </dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function Mono({ full }: { full: string }) {
  return (
    <span className="font-mono text-[11px]" title={full}>
      {short(full)}
    </span>
  );
}
