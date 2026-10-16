"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The bar's navigation (ADR 0102): in a row on a wide screen; on a phone folded behind a Menu
 * button, closed again when a page opens.
 */
export function BarMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <button type="button" className="quiet bar-toggle" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
        {open ? "Close" : "Menu"}
      </button>
      <nav id="site-menu" data-open={open}>{children}</nav>
    </>
  );
}
