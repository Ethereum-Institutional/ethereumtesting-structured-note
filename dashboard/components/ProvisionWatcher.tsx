"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { provisionMyAccount } from "@/app/platform-actions";
import { Badge } from "./ui";

/**
 * Drives custody-account provisioning from the browser, once the page has already rendered.
 *
 * Sign-up used to do this inline and took the better part of ten seconds, which fell apart under
 * even a handful of simultaneous sign-ups. Moving it here keeps sign-up instant, and the request
 * stays alive because the browser is holding it — unlike a fire-and-forget promise on a
 * serverless function, which can be killed the moment the response is sent.
 */
export function ProvisionWatcher() {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<"working" | "failed">("working");
  const [detail, setDetail] = useState("Opening your custody account…");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    (async () => {
      const result = await provisionMyAccount();
      if (cancelled) return;
      if (result.ok) {
        router.refresh();
      } else {
        setState("failed");
        setDetail(result.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div
      className="rounded border px-3 py-2.5"
      style={{
        borderColor: state === "failed" ? "rgba(255,107,107,.35)" : "rgba(91,156,255,.3)",
        background: state === "failed" ? "rgba(255,107,107,.06)" : "rgba(91,156,255,.06)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={state === "failed" ? "bad" : "accent"}>
          {state === "failed" ? "not ready" : "setting up"}
        </Badge>
        <span className="text-xs">{detail}</span>
        {state === "failed" && (
          <button
            onClick={() => {
              started.current = false;
              setState("working");
              setDetail("Retrying…");
              provisionMyAccount().then((r) => (r.ok ? router.refresh() : (setState("failed"), setDetail(r.message))));
            }}
            className="rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider"
            style={{ borderColor: "var(--line)", color: "var(--muted)" }}
          >
            retry
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
        You can fill in your details now — this finishes in the background.
      </p>
    </div>
  );
}
