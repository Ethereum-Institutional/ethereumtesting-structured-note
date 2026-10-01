"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The Operator pages' navigation column (ADR 0073). */
const ITEMS: Array<{ href: string; label: string; children?: Array<{ href: string; label: string }> }> = [
  { href: "/operator", label: "Access requests" },
  { href: "/operator/clients", label: "Clients" },
  {
    href: "/operator/custody/custodial",
    label: "Custody",
    children: [
      { href: "/operator/custody/custodial", label: "Custodial" },
      { href: "/operator/custody/third-party", label: "Third party" },
    ],
  },
  { href: "/operator/admissions", label: "Admissions" },
  { href: "/operator/notes", label: "Notes" },
  { href: "/operator/audit", label: "Audit log" },
];

export function OperatorNav() {
  const path = usePathname();
  const at = (href: string) => path === href;
  return (
    <nav className="console-nav" aria-label="Operator">
      <ul>
        {ITEMS.map((i) => (
          <li key={i.label}>
            {i.children ? (
              <>
                <span className={i.children.some((c) => at(c.href)) ? "group active" : "group"}>{i.label}</span>
                <ul>
                  {i.children.map((c) => (
                    <li key={c.href}><Link href={c.href} aria-current={at(c.href) ? "page" : undefined}>{c.label}</Link></li>
                  ))}
                </ul>
              </>
            ) : (
              <Link href={i.href} aria-current={at(i.href) ? "page" : undefined}>{i.label}</Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
