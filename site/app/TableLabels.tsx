"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Labels every table's cells with their column's heading, so that on a phone each row
 * reads as a card of label and value. The roles are set explicitly because a table restyled as
 * blocks loses them in some browsers' accessibility trees. Without this, a table scrolls in its box.
 */
function label(table: HTMLTableElement) {
  const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
  table.setAttribute("role", "table");
  table.querySelectorAll("thead, tbody").forEach((g) => g.setAttribute("role", "rowgroup"));
  table.querySelectorAll("tr").forEach((tr) => tr.setAttribute("role", "row"));
  table.querySelectorAll("th").forEach((th) => th.setAttribute("role", "columnheader"));
  table.querySelectorAll("tbody tr").forEach((tr) => {
    Array.from(tr.children).forEach((cell, i) => {
      if (cell.tagName !== "TD") return;
      cell.setAttribute("role", "cell");
      if (heads[i]) cell.setAttribute("data-label", heads[i]);
      else cell.removeAttribute("data-label");
    });
  });
  table.classList.add("labelled");
}

export function TableLabels() {
  const path = usePathname();
  useEffect(() => {
    const all = () => document.querySelectorAll("table").forEach((t) => label(t as HTMLTableElement));
    all();
    // Pages that refresh or update in place render new rows: label them as they arrive.
    const seen = new MutationObserver(() => all());
    seen.observe(document.body, { childList: true, subtree: true });
    return () => seen.disconnect();
  }, [path]);
  return null;
}
