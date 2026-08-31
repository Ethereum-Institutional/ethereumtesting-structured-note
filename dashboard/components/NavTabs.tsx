"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: Array<[string, string]> = [
  ["/", "Market"],
  ["/investors", "Investors"],
  ["/trade", "Trade"],
  ["/controls", "Controls"],
  ["/ledger", "Ledger"],
  ["/operations", "Operations"],
];

export function NavTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b pb-0" style={{ borderColor: "var(--line)" }}>
      {TABS.map(([href, label]) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className="rounded-t border border-b-0 px-3.5 py-1.5 text-xs transition-opacity hover:opacity-80"
            style={
              active
                ? { background: "var(--panel)", borderColor: "var(--line)", color: "var(--text)", fontWeight: 600 }
                : { borderColor: "transparent", color: "var(--muted)" }
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
