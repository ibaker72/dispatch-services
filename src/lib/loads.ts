import "server-only";
import { formatDateTime } from "@/lib/domain/dates";
import { LOAD_STATUS_LABELS, type LoadStatus } from "@/lib/domain/load-workflow";
import { formatMoney } from "@/lib/domain/money";
import { formatRate } from "@/lib/domain/mileage";
import { sendEmailSafely } from "@/lib/email/send";
import { getOperationsSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Carrier notifications for load events. Recipients are the carrier's active
 * portal owners (falling back to the company email). Reads use the service
 * role only to resolve recipients after the caller's own RLS-checked write
 * succeeded.
 */
async function carrierRecipients(carrierId: string): Promise<{ carrierName: string; emails: string[] }> {
  const admin = createSupabaseAdminClient();
  const { data: carrier } = await admin.from("carriers").select("legal_name, email, organization_id").eq("id", carrierId).single();
  if (!carrier) return { carrierName: "", emails: [] };
  const { data: owners } = await admin
    .from("organization_members")
    .select("profiles!organization_members_user_id_fkey(email)")
    .eq("organization_id", carrier.organization_id)
    .eq("status", "active")
    .eq("role", "carrier_owner");
  const emails = (owners ?? []).map((o) => o.profiles?.email).filter((e): e is string => Boolean(e));
  return { carrierName: carrier.legal_name, emails: emails.length ? emails : carrier.email ? [carrier.email] : [] };
}

async function loadSummary(loadId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("loads")
    .select("id, reference, carrier_id, status, gross_rate, loaded_rate_per_mile, load_stops(sequence, city, state, window_start, window_end)")
    .eq("id", loadId)
    .single();
  if (!data) return null;
  const stops = [...data.load_stops].sort((a, b) => a.sequence - b.sequence);
  const first = stops[0];
  const last = stops[stops.length - 1];
  return { ...data, lane: first && last ? `${first.city}, ${first.state} → ${last.city}, ${last.state}` : "", firstStop: first };
}

export async function notifyLoadProposed(loadId: string): Promise<void> {
  const load = await loadSummary(loadId);
  if (!load) return;
  const { timezone } = await getOperationsSettings();
  const { carrierName, emails } = await carrierRecipients(load.carrier_id);
  const pickupWindow = load.firstStop?.window_start
    ? `${formatDateTime(load.firstStop.window_start, timezone)}${load.firstStop.window_end ? ` – ${formatDateTime(load.firstStop.window_end, timezone)}` : ""}`
    : "To be confirmed";
  for (const to of emails) {
    await sendEmailSafely({
      to,
      template: "proposed_load_review",
      preferenceCategory: "load_updates",
      data: {
        carrierName,
        reference: load.reference,
        lane: load.lane,
        pickupWindow,
        grossRate: formatMoney(load.gross_rate),
        ratePerMile: load.loaded_rate_per_mile ? `${formatRate(load.loaded_rate_per_mile)} loaded` : "—",
        reviewUrl: absoluteUrl(`/portal/loads/${load.id}`),
      },
      carrierId: load.carrier_id,
      loadId: load.id,
      visibility: "carrier",
      dedupeKey: `load-proposed:${load.id}:${to}:${load.gross_rate}:${Date.now() - (Date.now() % 60_000)}`,
    });
  }
}

const NOTIFY_STATUSES: LoadStatus[] = ["booked", "delivered", "completed", "cancelled"];

export async function notifyLoadStatus(loadId: string, status: LoadStatus, note?: string | null): Promise<void> {
  if (!NOTIFY_STATUSES.includes(status)) return;
  const load = await loadSummary(loadId);
  if (!load) return;
  const { carrierName, emails } = await carrierRecipients(load.carrier_id);
  for (const to of emails) {
    await sendEmailSafely({
      to,
      template: "load_status_update",
      preferenceCategory: "load_updates",
      data: { carrierName, reference: load.reference, lane: load.lane, statusLabel: LOAD_STATUS_LABELS[status], note, loadUrl: absoluteUrl(`/portal/loads/${load.id}`) },
      carrierId: load.carrier_id,
      loadId: load.id,
      visibility: "carrier",
      dedupeKey: `load-status:${load.id}:${status}:${to}`,
    });
  }
}
