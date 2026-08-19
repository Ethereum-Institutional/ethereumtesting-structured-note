import { Badge } from "./ui";
import { STATUS_LABEL, type ApplicationStatus } from "@/lib/db/types";

export const STATUS_TONE: Record<ApplicationStatus, "ok" | "bad" | "warn" | "accent"> = {
  draft: "warn",
  submitted: "warn",
  in_review: "accent",
  approved: "ok",
  rejected: "bad",
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? "muted"}>{STATUS_LABEL[status] ?? status}</Badge>;
}
