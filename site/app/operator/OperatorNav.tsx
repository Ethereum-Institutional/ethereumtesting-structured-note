import { ConsoleNav, type NavItem } from "../ConsoleNav";

/** The Operator pages' navigation column (ADR 0073). */
export function OperatorNav({ custodyRequests = 0 }: { custodyRequests?: number }) {
  const items: NavItem[] = [
    { href: "/operator", label: "Access requests" },
    { href: "/operator/clients", label: "Clients" },
    {
      href: "/operator/custody/custodial",
      label: "Custody",
      children: [
        { href: "/operator/custody/custodial", label: custodyRequests ? `Custodial (${custodyRequests})` : "Custodial" },
        { href: "/operator/custody/third-party", label: "Third party" },
      ],
    },
    { href: "/operator/admissions", label: "Admissions" },
    { href: "/operator/notes", label: "Notes" },
    { href: "/operator/audit", label: "Audit log" },
  ];
  return <ConsoleNav label="Operator" items={items} />;
}
