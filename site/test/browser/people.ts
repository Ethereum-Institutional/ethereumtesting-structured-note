/**
 * Who the browser tests sign in as, and where their server keeps its state. Shared by the server
 * (test/browser/serve.ts), which seeds these people and sessions into a fresh store, and by the
 * tests, which present the session cookies.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PORT = 3031;
export const SITE = `http://localhost:${PORT}`;
export const STANDINS_PORT = 4021;
export const LAGGING_RPC_PORT = 4022;
export const WORK = join(tmpdir(), "structurednote-browser");
export const STORE_DIR = join(WORK, "store");
export const SERVER_LOG = join(WORK, "server.log");
/** In production the session cookie carries the __Host- prefix. */
export const COOKIE = "__Host-session";

export type Person = { id: string; email: string; name: string; organisation: string; status: "approved" | "pending" | "unverified"; sid: string };

export const PEOPLE = {
  operator: { id: "reg_operator", email: "operator@example.org", name: "Bank Operator", organisation: "The Bank", status: "approved", sid: "sid-operator-0123456789abcdef" },
  selfCustody: { id: "reg_self", email: "treasury@corp.example", name: "Treasury Lead", organisation: "Test Institution One", status: "approved", sid: "sid-self-custody-0123456789ab" },
  holder: { id: "reg_holder", email: "officer@corp.example", name: "Officer", organisation: "Test Institution One", status: "approved", sid: "sid-holder-wallet-0123456789a" },
  applicant: { id: "reg_applicant", email: "applicant@newco.example", name: "New Applicant", organisation: "Newco", status: "pending", sid: "sid-applicant-0123456789abcd" },
  declined: { id: "reg_declined", email: "declined@newco.example", name: "Declined Applicant", organisation: "Newco", status: "pending", sid: "sid-declined-0123456789abcde" },
  unconfirmed: { id: "reg_unconfirmed", email: "unconfirmed@newco.example", name: "Unconfirmed Applicant", organisation: "Newco", status: "unverified", sid: "sid-unconfirmed-0123456789ab" },
} satisfies Record<string, Person>;
