"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * While something is being built step by step, such as a note's issuance, asks the site
 * every few seconds to move it on, then re-renders the page. Stops when the page is left. The
 * action must be safe to repeat.
 */
export function Advance({ ids, advance, seconds = 8 }: { ids: string[]; advance: (id: string) => Promise<void>; seconds?: number }) {
  const router = useRouter();
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    let busy = false;
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        for (const id of key.split(",")) await advance(id);
      } catch {
        // Reported on the admission itself; the refresh shows it.
      } finally {
        busy = false;
        router.refresh();
      }
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [key, advance, router, seconds]);
  return null;
}
