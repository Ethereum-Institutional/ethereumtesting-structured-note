"use client";

import { useEffect } from "react";

/**
 * Graceful recovery instead of Next's white "Application error" page.
 *
 * The one crash this app actually meets in the field is a deploy landing under an open
 * session: the console refreshes itself every 6 seconds, and after a redeploy those requests
 * ask the new deployment for the old build's chunks and server actions. That is fatal to the
 * client runtime but entirely cured by a reload — so chunk/action mismatches reload once,
 * automatically, and anything else gets a calm screen with a reload button. Nobody presents
 * a stack trace to a room of bankers.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const stale =
      /ChunkLoadError|Loading chunk|failed to fetch|Failed to find Server Action|Connection closed/i.test(
        `${error?.name ?? ""} ${error?.message ?? ""}`,
      );
    // One automatic reload per incident, so a genuine loop still surfaces to the user.
    if (stale && !sessionStorage.getItem("auto-reloaded")) {
      sessionStorage.setItem("auto-reloaded", "1");
      location.reload();
    } else {
      sessionStorage.removeItem("auto-reloaded");
    }
  }, [error]);

  return (
    <main className="mx-auto max-w-md p-10 text-center">
      <h1 className="text-lg font-semibold tracking-tight">One moment —</h1>
      <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        The console hit a transient error, most often because a newer version was deployed while
        this page was open. Reloading fixes it.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <button
          onClick={() => location.reload()}
          className="rounded px-5 py-2 text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-90"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          Reload
        </button>
        <button
          onClick={() => reset()}
          className="rounded border px-5 py-2 text-xs uppercase tracking-wider transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}
        >
          Try again
        </button>
      </div>
      {error?.digest && (
        <p className="mt-4 font-mono text-[10px]" style={{ color: "var(--muted)" }}>
          ref {error.digest}
        </p>
      )}
    </main>
  );
}
