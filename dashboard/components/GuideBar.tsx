"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Presenter mode, generic: a fixed guide bar that runs a page as numbered steps.
 *
 * Each step spotlights the section it is about — every element carrying a [data-tour]
 * attribute dims except the step's target (see the CSS in globals.css) — scrolls it into
 * view, and gives the presenter script lines: what to SAY to the audience, what to DO on
 * screen, and what everyone should WATCH happen.
 *
 * Client-side only, so server refreshes never reset the presenter's place.
 */

export type GuideStep = {
  target: string; // matches a data-tour attribute on the page
  /** Page the step lives on. The bar navigates there when the presenter reaches the step. */
  href?: string;
  title: string;
  say?: string;
  act?: string;
  watch?: string;
};

const BTN =
  "rounded border px-2.5 py-1 text-[11px] uppercase tracking-wide transition-opacity hover:opacity-80 disabled:opacity-30";

export function GuideBar({
  steps,
  label,
  hint,
}: {
  steps: GuideStep[];
  /** The launch button's text, e.g. "Present demo". */
  label: string;
  /** One line of standing advice shown under the bar. */
  hint: string;
}) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!active) {
      document.body.removeAttribute("data-demo");
      document.querySelectorAll("[data-tour]").forEach((el) => el.removeAttribute("data-demo-focus"));
      return;
    }
    document.body.setAttribute("data-demo", "on");
    const s = steps[step];
    if (s.href && pathname !== s.href) router.push(s.href);

    // The step's page may still be loading after a navigation, so poll briefly for the target
    // rather than assuming it is already in the DOM.
    let tries = 0;
    const spotlight = () => {
      const el = document.querySelector(`[data-tour="${s.target}"]`);
      document.querySelectorAll("[data-tour]").forEach((n) => {
        if (n === el) n.setAttribute("data-demo-focus", "true");
        else n.removeAttribute("data-demo-focus");
      });
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (tries++ < 25) setTimeout(spotlight, 200);
    };
    spotlight();
    return () => {
      tries = 99; // stop any pending poll
      document.body.removeAttribute("data-demo");
    };
  }, [active, step, steps, pathname, router]);

  // Arrow keys advance the script, so the presenter never hunts for a button mid-pitch.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
      if (e.key === "Escape") setActive(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, steps.length]);

  if (!active) {
    return (
      <button
        onClick={() => {
          setStep(0);
          setActive(true);
        }}
        className="fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider shadow-lg transition-opacity hover:opacity-90"
        style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }}
      >
        ▶ {label}
      </button>
    );
  }

  const s = steps[step];

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t px-5 py-4"
      style={{ background: "var(--bg)", borderColor: "var(--accent)", boxShadow: "0 -8px 40px rgba(40,40,70,.15)" }}
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <span
              className="rounded px-2 py-0.5 font-mono text-[11px] font-semibold"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              step {step + 1} / {steps.length}
            </span>
            <span className="text-sm font-semibold tracking-tight">{s.title}</span>
          </div>
          <dl className="mt-2 space-y-1 text-xs leading-relaxed">
            {s.say && (
              <div className="flex gap-2">
                <dt className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--accent-2)" }}>
                  say
                </dt>
                <dd>&ldquo;{s.say}&rdquo;</dd>
              </div>
            )}
            {s.act && (
              <div className="flex gap-2">
                <dt className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--warn)" }}>
                  do
                </dt>
                <dd>{s.act}</dd>
              </div>
            )}
            {s.watch && (
              <div className="flex gap-2">
                <dt className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--ok)" }}>
                  watch
                </dt>
                <dd style={{ color: "var(--muted)" }}>{s.watch}</dd>
              </div>
            )}
          </dl>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          <button
            onClick={() => setStep((v) => Math.max(v - 1, 0))}
            disabled={step === 0}
            className={BTN}
            style={{ borderColor: "var(--line)", color: "var(--muted)" }}
          >
            ← back
          </button>
          {step < steps.length - 1 ? (
            <button
              onClick={() => setStep((v) => Math.min(v + 1, steps.length - 1))}
              className={BTN}
              style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }}
            >
              next →
            </button>
          ) : (
            <button
              onClick={() => setActive(false)}
              className={BTN}
              style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }}
            >
              finish
            </button>
          )}
          <button
            onClick={() => setActive(false)}
            className={BTN}
            style={{ borderColor: "var(--line)", color: "var(--muted)" }}
            title="Esc"
          >
            exit
          </button>
        </div>
      </div>
      <p className="mx-auto mt-2 max-w-[1400px] text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        ← → arrow keys step through · esc exits · {hint}
      </p>
    </div>
  );
}
