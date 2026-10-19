"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; badge?: number; children?: Array<{ href: string; label: string }> };

/** A console's navigation column: the Operator pages and the client's Onboard pages. */
export function ConsoleNav({ label, items }: { label: string; items: NavItem[] }) {
  const path = usePathname();
  const at = (href: string) => path === href;
  return (
    <nav className="console-nav" aria-label={label}>
      <ul>
        {items.map((i) => (
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
              <Link href={i.href} aria-current={at(i.href) ? "page" : undefined}>
                {i.label}
                {i.badge ? <span className="badge" aria-label={`${i.badge} waiting`}>{i.badge}</span> : null}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
