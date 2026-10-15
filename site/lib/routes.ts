/**
 * The onboarding routes as people see them (ADR 0089). Kept free of server code, so client pages
 * and the Ledger can name a route.
 */
export const ROUTE_LABEL: Record<string, string> = {
  "bank-custody": "Bank custody",
  "third-party": "Third-party custodian",
  "self-custody": "Self-custody",
  "existing-identity": "Existing identity",
};

export const routeLabel = (route: string | undefined | null) => (route ? ROUTE_LABEL[route] ?? route : "");
