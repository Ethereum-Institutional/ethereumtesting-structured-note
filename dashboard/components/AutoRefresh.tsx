"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server-rendered page current without a manual reload.
 *
 * These pages are two views of the same records — an investor edits their file, the compliance
 * officer reviews it — so a page that only updates when someone presses reload is actively
 * misleading: an admin watching the queue would not see a new sign-up arrive, or would act on a
 * file whose details had already changed.
 *
 * router.refresh() re-runs the server component and reconciles, so it does not disturb form state
 * or scroll position. Refreshing is skipped while the tab is hidden, since nobody is reading it.
 */
export function AutoRefresh({ seconds = 5, label = "live" }: { seconds?: number; label?: string }) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setUpdatedAt(new Date());
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds, paused]);

  return (
    <button
      onClick={() => setPaused((p) => !p)}
      title={paused ? "Resume automatic refresh" : "Pause automatic refresh"}
      className="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-opacity hover:opacity-80"
      style={{ borderColor: "var(--line)", color: paused ? "var(--muted)" : "var(--ok)" }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: paused ? "var(--muted)" : "var(--ok)" }}
      />
      {paused ? "paused" : label}
      {updatedAt && !paused && (
        <span style={{ color: "var(--muted)" }}>
          {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      )}
    </button>
  );
}
