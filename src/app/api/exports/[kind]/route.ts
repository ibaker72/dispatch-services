import { type NextRequest, NextResponse } from "next/server";
import { getAuthContext, isAdminRole } from "@/lib/auth/session";
import { parseWeek, weekStart } from "@/lib/domain/dates";
import { weeklyPerformance } from "@/lib/reports/performance";
import { RateLimitError, enforceRateLimit } from "@/lib/security/rate-limit";
import { toCsv } from "@/lib/security/csv";
import { getOperationsSettings } from "@/lib/settings";

/**
 * CSV exports for staff. Every query runs with the signed-in user's client,
 * so RLS scopes rows exactly as in the dashboard; cells are neutralized
 * against spreadsheet formula injection by toCsv().
 */
const ADMIN_ONLY = new Set(["audit", "waitlist"]);
const KINDS = new Set(["performance", "loads", "invoices", "audit", "waitlist", "carriers"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!KINDS.has(kind)) return new NextResponse("Not found", { status: 404 });
  const ctx = await getAuthContext();
  if (!ctx || !ctx.staffRoles.length) return new NextResponse("Not found", { status: 404 });
  if (ADMIN_ONLY.has(kind) && !isAdminRole(ctx.staffRoles)) return new NextResponse("Not found", { status: 404 });
  try {
    await enforceRateLimit("export", ctx.userId);
  } catch (error) {
    if (error instanceof RateLimitError) return new NextResponse(error.message, { status: 429 });
    throw error;
  }

  const sp = request.nextUrl.searchParams;
  const { timezone } = await getOperationsSettings();
  let headers: string[] = [];
  let rows: unknown[][] = [];
  let name: string = kind;

  if (kind === "performance") {
    const week = parseWeek(sp.get("week") ?? undefined, weekStart(new Date(), timezone));
    const data = await weeklyPerformance(ctx.supabase, week);
    headers = ["Week start", "Carrier", "Completed loads", "Carrier gross revenue", "Accessorials", "Loaded miles", "Deadhead miles", "Deadhead %", "Loaded rate per mile", "All-in rate per mile", "Per-load dispatch fee"];
    rows = data.map((r) => [week, r.carrierName, r.loads, r.carrierGross, r.accessorials, r.loadedMiles, r.deadheadMiles, r.deadheadPercentage, r.loadedRatePerMile, r.allInRatePerMile, r.dispatchFee]);
    name = `performance-${week}`;
  } else if (kind === "loads") {
    const { data } = await ctx.supabase
      .from("loads")
      .select("reference, status, broker_name, broker_load_number, gross_rate, loaded_miles, deadhead_miles, loaded_rate_per_mile, estimated_dispatch_fee, created_at, completed_at, carriers(legal_name)")
      .order("created_at", { ascending: false })
      .limit(5000);
    headers = ["Reference", "Carrier", "Status", "Broker", "Broker load #", "Gross rate", "Loaded miles", "Deadhead miles", "Loaded RPM", "Estimated dispatch fee", "Created", "Completed"];
    rows = (data ?? []).map((l) => [l.reference, l.carriers?.legal_name, l.status, l.broker_name, l.broker_load_number, l.gross_rate, l.loaded_miles, l.deadhead_miles, l.loaded_rate_per_mile, l.estimated_dispatch_fee, l.created_at, l.completed_at]);
  } else if (kind === "invoices") {
    const { data } = await ctx.supabase
      .from("invoices")
      .select("invoice_number, status, issue_date, due_date, total, amount_paid, balance_due, paid_at, carriers(legal_name)")
      .order("created_at", { ascending: false })
      .limit(5000);
    headers = ["Invoice", "Carrier", "Status", "Issued", "Due", "Total", "Paid", "Balance", "Paid at"];
    rows = (data ?? []).map((i) => [i.invoice_number, i.carriers?.legal_name, i.status, i.issue_date, i.due_date, i.total, i.amount_paid, i.balance_due, i.paid_at]);
  } else if (kind === "carriers") {
    const { data } = await ctx.supabase
      .from("carriers")
      .select("legal_name, dba_name, status, mc_number, usdot_number, email, phone, home_base_city, home_base_state, insurance_expiration_date, authority_verification_status, activated_at")
      .is("deleted_at", null)
      .order("legal_name");
    headers = ["Legal name", "DBA", "Status", "MC", "USDOT", "Email", "Phone", "Home city", "Home state", "Insurance expires", "Authority verification", "Activated"];
    rows = (data ?? []).map((c) => [c.legal_name, c.dba_name, c.status, c.mc_number, c.usdot_number, c.email, c.phone, c.home_base_city, c.home_base_state, c.insurance_expiration_date, c.authority_verification_status, c.activated_at]);
  } else if (kind === "audit") {
    let query = ctx.supabase.from("audit_events").select("occurred_at, action, severity, actor_kind, actor_id, entity_type, entity_id, carrier_id, ip_address, metadata").order("occurred_at", { ascending: false }).limit(10000);
    const severity = sp.get("severity");
    if (severity === "security" || severity === "info" || severity === "warning") query = query.eq("severity", severity);
    const { data } = await query;
    headers = ["Occurred", "Action", "Severity", "Actor kind", "Actor", "Entity type", "Entity", "Carrier", "IP", "Details"];
    rows = (data ?? []).map((e) => [e.occurred_at, e.action, e.severity, e.actor_kind, e.actor_id, e.entity_type, e.entity_id, e.carrier_id, e.ip_address, e.metadata]);
  } else if (kind === "waitlist") {
    const { data } = await ctx.supabase.from("lease_on_waitlist").select("*").order("created_at", { ascending: false }).limit(10000);
    const cols = data && data[0] ? Object.keys(data[0]) : [];
    headers = cols;
    rows = (data ?? []).map((r) => cols.map((c) => (r as Record<string, unknown>)[c]));
  }

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
