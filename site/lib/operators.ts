/**
 * Who is an operator: an explicit list in OPERATOR_EMAILS, with no default and no domain rule.
 * Kept apart from the session code so the admission service can use it outside a request.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const emailList = (v: string | undefined) => (v ?? "").split(",").map(normaliseEmail).filter(Boolean);

export function isOperator(email: string): boolean {
  return emailList(process.env.OPERATOR_EMAILS).includes(email);
}
