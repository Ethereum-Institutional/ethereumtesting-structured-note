/**
 * The onboarding routes as people see them (ADR 0074). The stored values stay as they are; the
 * route kept as "self-custody" is shown as Third party, because the bank knows the client controls
 * the wallet, not whether the client holds it itself or another custodian holds it for it.
 */
export const ROUTE_LABEL: Record<string, string> = {
  custodied: "Custodial",
  "self-custody": "Third party",
  "holder-wallet": "Holder wallet",
};

export const routeLabel = (route: string | undefined | null) => (route ? ROUTE_LABEL[route] ?? route : "");
