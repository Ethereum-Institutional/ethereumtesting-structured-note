/**
 * Who is staff, and in which portals: explicit lists, with no default and no domain rule.
 * Kept apart from the session code so the admission service can use it outside a request.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const emailList = (v: string | undefined) => (v ?? "").split(",").map(normaliseEmail).filter(Boolean);

/**
 * The staff portals (ADR 0089). Each has its own list of emails; OPERATOR_EMAILS grants all four,
 * so one person can demonstrate every role.
 */
export const ROLES = ["bank", "onboarding", "agent", "custodian"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  bank: "The bank",
  onboarding: "Onboarding agent",
  agent: "The Agent",
  custodian: "Custodians",
};

const ROLE_ENV: Record<Role, string> = {
  bank: "BANK_EMAILS",
  onboarding: "ONBOARDING_EMAILS",
  agent: "AGENT_EMAILS",
  custodian: "CUSTODIAN_EMAILS",
};

export function rolesOf(email: string, env: NodeJS.ProcessEnv = process.env): Role[] {
  const e = normaliseEmail(email);
  if (emailList(env.OPERATOR_EMAILS).includes(e)) return [...ROLES];
  return ROLES.filter((r) => emailList(env[ROLE_ENV[r]]).includes(e));
}

export function hasRole(email: string, role: Role, env: NodeJS.ProcessEnv = process.env): boolean {
  return rolesOf(email, env).includes(role);
}

/** Staff in any portal. */
export function isOperator(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return rolesOf(email, env).length > 0;
}
