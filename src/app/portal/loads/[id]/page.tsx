import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addCarrierLoadNote, respondToLoad } from "../../actions";
import { ActionForm, ConfirmAction, FormField } from "@/components/action-form";
import { DocumentTable, type DocumentRow } from "@/components/dashboard/document-table";
import { DocumentUploadForm } from "@/components/document-upload";
import { LoadStatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList } from "@/components/ui/detail-list";
import { Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EQUIPMENT_LABELS, type EquipmentKey } from "@/config/business";
import { requireCarrierUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/db/query";
import { formatDateTime } from "@/lib/domain/dates";
import { CHARGE_TYPE_LABELS, DOCUMENT_TYPE_LABELS, LOAD_DOCUMENT_TYPES } from "@/lib/domain/labels";
import { LOAD_STATUS_LABELS, type LoadStatus } from "@/lib/domain/load-workflow";
import { formatMoney } from "@/lib/domain/money";
import { formatMiles, formatRate } from "@/lib/domain/mileage";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Load" };

export default async function PortalLoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCarrierUser();
  const { timezone } = await getOperationsSettings();
  const { data: load } = await ctx.supabase.from("loads").select("*").eq("id", id).maybeSingle();
  if (!load) notFound();
  const [stops, vehicles, charges, notes, history, docs, truck, driver, snapshot] = await Promise.all([
    ctx.supabase.from("load_stops").select("*").eq("load_id", id).order("sequence"),
    ctx.supabase.from("load_vehicles").select("*").eq("load_id", id),
    ctx.supabase.from("load_charges").select("id, charge_type, amount, description").eq("load_id", id),
    ctx.supabase.from("load_notes").select("id, body, created_at, author_id").eq("load_id", id).order("created_at", { ascending: false }),
    ctx.supabase.from("load_status_history").select("id, to_status, changed_at").eq("load_id", id).order("changed_at", { ascending: false }),
    ctx.supabase
      .from("documents")
      .select("id, doc_type, status, original_filename, size_bytes, expires_on, uploaded_at, review_note")
      .eq("load_id", id)
      .is("deleted_at", null)
      .neq("status", "uploading")
      .order("uploaded_at", { ascending: false }),
    load.truck_id ? ctx.supabase.from("trucks").select("unit_number").eq("id", load.truck_id).maybeSingle() : Promise.resolve({ data: null }),
    load.driver_id ? ctx.supabase.from("drivers").select("full_name").eq("id", load.driver_id).maybeSingle() : Promise.resolve({ data: null }),
    ctx.supabase.from("fee_snapshots").select("eligible_revenue, dispatch_fee, fee_model").eq("load_id", id).maybeSingle(),
  ]);
  const status = load.status as LoadStatus;
  const owner = ctx.membership.role === "carrier_owner";
  const stopRows = stops.data ?? [];
  const first = stopRows[0];
  const last = stopRows[stopRows.length - 1];
  const canUpload = status !== "cancelled" && status !== "proposed";

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/portal/loads" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Loads
          </Link>
        }
        title={`Load ${load.reference}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <LoadStatusBadge status={status} audience="carrier" />
            {first && last ? `${first.city}, ${first.state} → ${last.city}, ${last.state}` : null}
          </span>
        }
      />

      {status === "proposed" ? (
        <Card className="mb-6 border-accent">
          <CardHeader>
            <CardTitle>Your decision</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-steel-700">
              Review the rate, miles and pickup window. Approving tells your dispatcher to book this load with the broker for your truck and driver. Rejecting sends it back to the broker.
            </p>
            {owner ? (
              <div className="flex flex-wrap gap-2">
                <ConfirmAction
                  action={respondToLoad}
                  title={`Approve load ${load.reference}?`}
                  description={`Rate ${formatMoney(load.gross_rate)} for ${formatMiles(load.loaded_miles)} loaded (${formatRate(load.loaded_rate_per_mile)}).`}
                  triggerLabel="Approve load"
                  triggerVariant="primary"
                  triggerSize="md"
                  confirmLabel="Approve"
                  confirmVariant="primary"
                >
                  <input type="hidden" name="load_id" value={load.id} />
                  <input type="hidden" name="decision" value="approved" />
                  <FormField id="approve-note" name="note" label="Note for your dispatcher (optional)">
                    <Textarea name="note" rows={2} maxLength={2000} />
                  </FormField>
                </ConfirmAction>
                <ConfirmAction action={respondToLoad} title={`Reject load ${load.reference}?`} triggerLabel="Reject" triggerSize="md" confirmLabel="Reject load">
                  <input type="hidden" name="load_id" value={load.id} />
                  <input type="hidden" name="decision" value="rejected" />
                  <FormField id="reject-note" name="note" label="Reason" required>
                    <Textarea name="note" rows={2} maxLength={2000} placeholder="Rate too low, truck not available, lane not wanted…" />
                  </FormField>
                </ConfirmAction>
              </div>
            ) : (
              <Alert tone="info">Your company owner approves or rejects proposed loads.</Alert>
            )}
          </CardBody>
        </Card>
      ) : null}
      {status === "cancelled" ? (
        <Alert tone="danger" title="Cancelled" className="mb-6">
          {load.cancellation_reason}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Stops</CardTitle>
            </CardHeader>
            <ol className="divide-y divide-steel-100">
              {stopRows.map((s) => (
                <li key={s.id} className="px-5 py-3 text-sm">
                  <p className="font-semibold">
                    {s.sequence}. {s.stop_type === "pickup" ? "Pickup" : "Delivery"} — {s.city}, {s.state} {s.postal_code ?? ""}
                  </p>
                  <p className="text-steel-700">{[s.facility_name, s.address_line1].filter(Boolean).join(", ")}</p>
                  <p className="text-steel-600">
                    {s.window_start ? formatDateTime(s.window_start, timezone) : "Time to be confirmed"}
                    {s.window_end ? ` – ${formatDateTime(s.window_end, timezone)}` : ""}
                    {s.appointment_type === "fcfs" ? " (first come, first served)" : s.appointment_type === "appointment" ? " (appointment)" : ""}
                  </p>
                  {s.contact_name || s.contact_phone ? <p className="text-steel-600">Contact: {[s.contact_name, s.contact_phone].filter(Boolean).join(" · ")}</p> : null}
                  {s.instructions ? <p className="text-steel-600">{s.instructions}</p> : null}
                </li>
              ))}
            </ol>
          </Card>

          {(vehicles.data ?? []).length ? (
            <Card>
              <CardHeader>
                <CardTitle>Vehicles</CardTitle>
              </CardHeader>
              <ul className="divide-y divide-steel-100">
                {vehicles.data!.map((v) => (
                  <li key={v.id} className="px-5 py-3 text-sm">
                    <p className="font-semibold">
                      {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                      {!v.operable ? <span className="ml-2 text-xs text-warning">Inoperable</span> : null}
                    </p>
                    <p className="font-mono text-xs text-steel-600">{v.vin ? `VIN ${v.vin}` : ""}</p>
                    <p className="text-steel-600">
                      {[v.lot_number ? `Lot ${v.lot_number}` : null, v.auction_or_dealer_name, v.keys_title_notes].filter(Boolean).join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-sm text-steel-600">Required to complete: {load.required_documents.map((t) => DOCUMENT_TYPE_LABELS[t]).join(", ")}.</p>
              {canUpload ? (
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">Upload BOL, POD or other load paperwork</summary>
                  <div className="mt-3">
                    <DocumentUploadForm carrierId={load.carrier_id} loadId={load.id} types={LOAD_DOCUMENT_TYPES} defaultType="proof_of_delivery" idPrefix="portal-load-doc" />
                  </div>
                </details>
              ) : null}
            </CardBody>
            {(docs.data ?? []).length ? <DocumentTable documents={docs.data as DocumentRow[]} caption="Load documents" /> : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Messages with your dispatcher</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <ActionForm action={addCarrierLoadNote} submitLabel="Send" submitSize="sm" resetOnSuccess>
                <input type="hidden" name="load_id" value={load.id} />
                <FormField id="note-body" name="body" label="Message">
                  <Textarea name="body" rows={2} maxLength={5000} />
                </FormField>
              </ActionForm>
              <ul className="space-y-3 text-sm">
                {(notes.data ?? []).map((n) => (
                  <li key={n.id} className="rounded-md border border-steel-200 p-3">
                    <p className="whitespace-pre-line">{n.body}</p>
                    <p className="mt-1 text-xs text-steel-600">
                      {n.author_id === ctx.userId ? "You" : "Dispatch team"} · {formatDateTime(n.created_at, timezone)}
                    </p>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Rate</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <DetailList
                columns={1}
                items={[
                  ["Gross rate (paid to you by the broker)", <span key="g" className="text-lg font-semibold">{formatMoney(load.gross_rate)}</span>],
                  ["Loaded / deadhead miles", `${formatMiles(load.loaded_miles)} / ${formatMiles(load.deadhead_miles)}`],
                  ["Rate per loaded mile", formatRate(load.loaded_rate_per_mile)],
                  ["All-in rate per mile", formatRate(load.all_in_rate_per_mile)],
                  ["Equipment", load.equipment_type ? (EQUIPMENT_LABELS[load.equipment_type as EquipmentKey] ?? load.equipment_type) : null],
                  ["Commodity", [load.commodity, load.weight_lbs ? `${Number(load.weight_lbs).toLocaleString()} lb` : null].filter(Boolean).join(" · ")],
                  ["Broker", load.broker_name],
                  ["Broker load #", load.broker_load_number],
                  ["Truck / driver", [truck.data?.unit_number, driver.data?.full_name].filter(Boolean).join(" · ") || null],
                ]}
              />
              {(charges.data ?? []).length ? (
                <div className="text-sm">
                  <p className="font-semibold">Accessorials</p>
                  <ul>
                    {charges.data!.map((c) => (
                      <li key={c.id}>
                        {CHARGE_TYPE_LABELS[c.charge_type]}: {formatMoney(c.amount)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="rounded-md bg-paper-2 p-3 text-sm">
                {snapshot.data ? (
                  <p>
                    Dispatch fee for this load: <span className="font-semibold">{snapshot.data.fee_model === "flat_weekly" ? "included in your weekly per-truck fee" : formatMoney(snapshot.data.dispatch_fee)}</span>
                  </p>
                ) : load.fee_model === "flat_weekly" ? (
                  <p>Your plan is a flat weekly fee per active truck; there is no per-load fee.</p>
                ) : (
                  <p>
                    Estimated dispatch fee: <span className="font-semibold">{formatMoney(load.estimated_dispatch_fee)}</span>
                    <span className="block text-xs text-steel-600">Final fee is fixed when the load is completed.</span>
                  </p>
                )}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardBody>
              <ol className="space-y-2 text-sm">
                {(history.data ?? []).map((h) => (
                  <li key={h.id}>
                    <span className="font-medium">{LOAD_STATUS_LABELS[h.to_status as LoadStatus]}</span>
                    <span className="block text-xs text-steel-600">{formatDateTime(h.changed_at, timezone)}</span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
