/**
 * Load workflow rules shared by the UI. The database trigger
 * (app.guard_load_write) is authoritative; this module mirrors it so the UI
 * can explain what is missing before a dispatcher tries an action. Parity is
 * covered by tests.
 */

export const LOAD_STATUSES = [
  "opportunity",
  "proposed",
  "approved",
  "booked",
  "dispatched",
  "at_pickup",
  "loaded",
  "in_transit",
  "delivered",
  "paperwork_pending",
  "completed",
  "cancelled",
] as const;

export type LoadStatus = (typeof LOAD_STATUSES)[number];

export const LOAD_TRANSITIONS: Record<LoadStatus, readonly LoadStatus[]> = {
  opportunity: ["proposed", "cancelled"],
  proposed: ["approved", "opportunity", "cancelled"],
  approved: ["booked", "proposed", "opportunity", "cancelled"],
  booked: ["dispatched", "cancelled"],
  dispatched: ["at_pickup", "cancelled"],
  at_pickup: ["loaded", "cancelled"],
  loaded: ["in_transit"],
  in_transit: ["delivered"],
  delivered: ["paperwork_pending", "completed"],
  paperwork_pending: ["completed"],
  completed: [],
  cancelled: [],
};

export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  opportunity: "Opportunity",
  proposed: "Awaiting carrier",
  approved: "Carrier approved",
  booked: "Booked",
  dispatched: "Dispatched",
  at_pickup: "At pickup",
  loaded: "Loaded",
  in_transit: "In transit",
  delivered: "Delivered",
  paperwork_pending: "Paperwork pending",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const ACTIVE_LOAD_STATUSES: LoadStatus[] = ["booked", "dispatched", "at_pickup", "loaded", "in_transit"];
export const CLOSED_LOAD_STATUSES: LoadStatus[] = ["completed", "cancelled"];

export function canTransition(from: LoadStatus, to: LoadStatus): boolean {
  return LOAD_TRANSITIONS[from].includes(to);
}

/**
 * Transitions a dispatcher may trigger directly. "approved" is excluded: only
 * the carrier (portal) or a recorded carrier decision moves a load there.
 */
export function dispatcherNextStatuses(from: LoadStatus): LoadStatus[] {
  return LOAD_TRANSITIONS[from].filter((s) => s !== "approved");
}

export interface BookingReadinessInput {
  status: LoadStatus;
  truckId: string | null;
  driverId: string | null;
  grossRate: number | string | null;
  loadedMiles: number | string | null;
  pickupStops: number;
  deliveryStops: number;
  hasValidApproval: boolean;
  carrierContracted: boolean;
}

/** Human-readable reasons a load cannot be booked yet (empty when it can). */
export function bookingBlockers(input: BookingReadinessInput): string[] {
  const blockers: string[] = [];
  if (input.status !== "approved") blockers.push("The carrier must approve the load first.");
  if (!input.carrierContracted) blockers.push("The carrier must be active with an accepted service agreement and fee terms.");
  if (!input.hasValidApproval) blockers.push("A carrier approval matching the current rate is required.");
  if (!input.truckId) blockers.push("Assign a specific truck.");
  if (!input.driverId) blockers.push("Assign a specific driver.");
  if (!(Number(input.grossRate) > 0)) blockers.push("Enter the gross rate.");
  if (!(Number(input.loadedMiles) > 0)) blockers.push("Enter loaded miles.");
  if (input.pickupStops < 1 || input.deliveryStops < 1) blockers.push("Add at least one pickup and one delivery stop.");
  return blockers;
}

/** Maps database error hints raised by workflow triggers to user-facing messages. */
export const WORKFLOW_HINT_MESSAGES: Record<string, string> = {
  load_reassignment_forbidden:
    "Loads cannot be moved to another carrier. Cancel the load and return it to the broker instead.",
  carrier_approval_required: "The carrier has not approved this load at its current rate.",
  truck_and_driver_required: "Assign a specific truck and driver before booking.",
  truck_inactive: "The assigned truck is not active.",
  driver_inactive: "The assigned driver is not active.",
  rate_required: "Rate and loaded miles are required.",
  stops_required: "Add at least one pickup and one delivery stop.",
  carrier_not_contracted: "This carrier is not active with an accepted service agreement and fee terms.",
  documents_required: "Upload the rate confirmation, bill of lading and proof of delivery before completing.",
  reason_required: "Please include a reason.",
  invalid_transition: "That status change is not allowed from the load's current status.",
  immutable_record: "This record is closed and can no longer be changed.",
  invalid_initial_status: "New loads start as opportunities.",
  onboarding_incomplete: "Onboarding is not complete yet. Finish every checklist item before activation.",
  attorney_approval_required: "This agreement can only be published after attorney approval is recorded.",
  lease_on_not_ready: "Lease-on operations cannot be enabled until the compliance checklist is complete.",
  invitation_expired: "This invitation has expired. Ask for a new one.",
  invitation_used: "This invitation has already been used.",
  invitation_email_mismatch: "This invitation was sent to a different email address. Sign in with that address.",
  fee_contract_required: "No fee terms apply to this carrier for this date.",
  overpayment: "The payment is larger than the balance due.",
  payment_required: "Record a payment before marking an invoice paid.",
};
