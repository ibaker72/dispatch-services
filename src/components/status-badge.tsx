import { Badge, type BadgeTone } from "@/components/ui/badge";
import { LOAD_STATUS_LABELS, type LoadStatus } from "@/lib/domain/load-workflow";
import { titleCase } from "@/lib/utils";

const LOAD_TONES: Record<LoadStatus, BadgeTone> = {
  opportunity: "neutral",
  proposed: "accent",
  approved: "info",
  booked: "navy",
  dispatched: "info",
  at_pickup: "info",
  loaded: "info",
  in_transit: "info",
  delivered: "success",
  paperwork_pending: "warning",
  completed: "success",
  cancelled: "danger",
};

/** Carrier-facing wording for statuses that read differently from the carrier's side. */
const CARRIER_LABELS: Partial<Record<LoadStatus, string>> = { proposed: "Needs your decision", approved: "You approved" };

export function LoadStatusBadge({ status, audience = "staff" }: { status: LoadStatus; audience?: "staff" | "carrier" }) {
  const label = (audience === "carrier" ? CARRIER_LABELS[status] : undefined) ?? LOAD_STATUS_LABELS[status];
  return <Badge tone={LOAD_TONES[status]}>{label}</Badge>;
}

const GENERIC_TONES: Record<string, BadgeTone> = {
  draft: "neutral",
  submitted: "accent",
  under_review: "info",
  information_requested: "warning",
  approved: "success",
  declined: "danger",
  onboarding: "info",
  active: "success",
  inactive: "neutral",
  open: "accent",
  paid: "success",
  void: "neutral",
  uncollectible: "danger",
  issued: "info",
  uploading: "neutral",
  pending_review: "warning",
  accepted: "success",
  rejected: "danger",
  expired: "danger",
  superseded: "neutral",
  in_progress: "info",
  done: "success",
  cancelled: "neutral",
  resolved: "success",
  closed: "neutral",
  waiting_on_carrier: "warning",
  succeeded: "success",
  failed: "danger",
  pending: "warning",
  refunded: "neutral",
  verified: "success",
  unverified: "warning",
  queued: "neutral",
  sent: "success",
  logged: "neutral",
  new: "accent",
  contacted: "info",
  archived: "neutral",
  published: "success",
  retired: "neutral",
};

const LABEL_OVERRIDES: Record<string, string> = {
  information_requested: "Info requested",
  pending_review: "Pending review",
  waiting_on_carrier: "Waiting on carrier",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={GENERIC_TONES[status] ?? "neutral"}>{LABEL_OVERRIDES[status] ?? titleCase(status)}</Badge>;
}
