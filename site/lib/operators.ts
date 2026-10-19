/**
 * Who is staff, and in which portals: explicit lists, with no default and no domain rule.
 * Kept apart from the session code so the admission service can use it outside a request.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const emailList = (v: string | undefined) => (v ?? "").split(",").map(normaliseEmail).filter(Boolean);

/**
 * The staff portals. Each has its own list of emails; OPERATOR_EMAILS grants all four,
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

/** An admin: staff in OPERATOR_EMAILS, who hold every portal and alone may delete a registration. */
export function isAdmin(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return emailList(env.OPERATOR_EMAILS).includes(normaliseEmail(email));
}

/** Staff in any portal. */
export function isOperator(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return rolesOf(email, env).length > 0;
}

/**
 * Duties within the Agent's desk, each needing four eyes: determining a note's dates as the
 * Calculation Agent, and paying its coupons and redemptions. Each has its own list of emails; where
 * a list is not set, everyone at the Agent's desk holds that duty. Operators hold both.
 */
export const DUTIES = ["calculation", "payments"] as const;
export type Duty = (typeof DUTIES)[number];

export const DUTY_LABEL: Record<Duty, string> = {
  calculation: "Calculation Agent",
  payments: "Payments",
};

const DUTY_ENV: Record<Duty, string> = {
  calculation: "CALCULATION_EMAILS",
  payments: "PAYMENTS_EMAILS",
};

export function hasDuty(email: string, duty: Duty, env: NodeJS.ProcessEnv = process.env): boolean {
  const e = normaliseEmail(email);
  if (emailList(env.OPERATOR_EMAILS).includes(e)) return true;
  const listed = env[DUTY_ENV[duty]];
  return listed?.trim() ? emailList(listed).includes(e) : hasRole(e, "agent", env);
}

/**
 * Whether a second person must approve what a colleague proposed (FOUR_EYES=strict), or the
 * deployment's automatic second approver approves it at once (FOUR_EYES=auto, the default, for the
 * demonstration). Either way the approval is recorded, and an automatic one says so.
 */
export function automaticSecondApprover(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.FOUR_EYES ?? "auto").trim().toLowerCase() !== "strict";
}

/** The name the automatic second approver's approvals are recorded under. */
export const AUTOMATIC_APPROVER = "the automatic second approver";
