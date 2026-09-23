import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssignmentForm, LoadDetailsForm, StopForm, VehicleForm } from "./_parts/forms";
import {
  addCharge,
  addLoadNote,
  cancelLoad,
  changeLoadStatus,
  recordCarrierDecision,
  recordStopTime,
  removeCharge,
  removeStop,
  removeVehicle,
} from "../actions";
import { ActionForm, ConfirmAction, FormDialog, FormField } from "@/components/action-form";
import { DocumentReviewActions } from "@/components/dashboard/document-review";
import { DocumentTable, type DocumentRow } from "@/components/dashboard/document-table";
import { DocumentUploadForm } from "@/components/document-upload";
import { LoadStatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList } from "@/components/ui/detail-list";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EQUIPMENT_LABELS, type EquipmentKey } from "@/config/business";
import { isAdminRole, requireStaff } from "@/lib/auth/session";
import { isUuid } from "@/lib/db/query";
import { formatDateTime } from "@/lib/domain/dates";
import { CHARGE_TYPE_LABELS, DOCUMENT_TYPE_LABELS, LOAD_DOCUMENT_TYPES, TRAILER_TYPE_LABELS } from "@/lib/domain/labels";
import { LOAD_STATUS_LABELS, type LoadStatus, bookingBlockers, dispatcherNextStatuses } from "@/lib/domain/load-workflow";
import { formatMoney } from "@/lib/domain/money";
import { formatMiles, formatRate } from "@/lib/domain/mileage";
import { getOperationsSettings } from "@/lib/settings";
import { listDispatchers, staffLabel } from "@/lib/staff";
import { Constants } from "@/lib/db/database.types";
import { VEHICLE_TYPE_LABELS } from "@/lib/validation/load";

export const metadata = { title: "Load" };

const NEXT_LABELS: Partial<Record<LoadStatus, string>> = {
  proposed: "Send to carrier for approval",
  opportunity: "Move back to opportunity",
  booked: "Book load",
  dispatched: "Mark dispatched",
  at_pickup: "Arrived at pickup",
  loaded: "Loaded",
  in_transit: "In transit",
  delivered: "Delivered",
  paperwork_pending: "Waiting on paperwork",
  completed: "Complete load",
};

export default async function LoadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireStaff();
  const admin = isAdminRole(ctx.staffRoles);
  const { timezone } = await getOperationsSettings();

  const { data: load } = await ctx.supabase.from("loads").select("*").eq("id", id).maybeSingle();
  if (!load) notFound();

  const [carrier, stops, vehicles, charges, notes, history, approvals, docs, snapshot, trucks, trailers, drivers, brokers, dispatchers] =
    await Promise.all([
      ctx.supabase.from("carriers").select("id, legal_name, status, organization_id").eq("id", load.carrier_id).single(),
      ctx.supabase.from("load_stops").select("*").eq("load_id", id).order("sequence"),
      ctx.supabase.from("load_vehicles").select("*").eq("load_id", id).order("created_at"),
      ctx.supabase.from("load_charges").select("*").eq("load_id", id).order("created_at"),
      ctx.supabase
        .from("load_notes")
        .select("id, body, visibility, kind, created_at, profiles!load_notes_author_id_fkey(full_name, email)")
        .eq("load_id", id)
        .order("created_at", { ascending: false }),
      ctx.supabase
        .from("load_status_history")
        .select("id, from_status, to_status, note, changed_at, changed_by")
        .eq("load_id", id)
        .order("changed_at", { ascending: false }),
      ctx.supabase.from("load_approvals").select("*").eq("load_id", id).order("decided_at", { ascending: false }),
      ctx.supabase
        .from("documents")
        .select("id, doc_type, status, original_filename, size_bytes, expires_on, uploaded_at, review_note")
        .eq("load_id", id)
        .is("deleted_at", null)
        .neq("status", "uploading")
        .order("uploaded_at", { ascending: false }),
      ctx.supabase.from("fee_snapshots").select("*").eq("load_id", id).maybeSingle(),
      ctx.supabase.from("trucks").select("id, unit_number, status").eq("carrier_id", load.carrier_id).order("unit_number"),
      ctx.supabase.from("trailers").select("id, trailer_type, status").eq("carrier_id", load.carrier_id),
      ctx.supabase.from("drivers").select("id, full_name, status").eq("carrier_id", load.carrier_id).order("full_name"),
      ctx.supabase.from("brokers").select("id, name").order("name").limit(500),
      admin ? listDispatchers(ctx.supabase) : Promise.resolve([]),
    ]);

  const status = load.status as LoadStatus;
  const closed = status === "completed" || status === "cancelled";
  const stopRows = stops.data ?? [];
  const docRows = (docs.data ?? []) as DocumentRow[];
  const liveApproval = (approvals.data ?? []).find(
    (a) => a.decision === "approved" && !a.superseded_at && Number(a.approved_gross_rate) === Number(load.gross_rate),
  );
  const blockers = bookingBlockers({
    status,
    truckId: load.truck_id,
    driverId: load.driver_id,
    grossRate: load.gross_rate,
    loadedMiles: load.loaded_miles,
    pickupStops: stopRows.filter((s) => s.stop_type === "pickup").length,
    deliveryStops: stopRows.filter((s) => s.stop_type === "delivery").length,
    hasValidApproval: Boolean(liveApproval),
    carrierContracted: carrier.data?.status === "active",
  });
  const missingDocs = load.required_documents.filter(
    (t) => !docRows.some((d) => d.doc_type === t && (d.status === "pending_review" || d.status === "accepted")),
  );
  const next = dispatcherNextStatuses(status).filter((s) => s !== "cancelled");
  const truck = (trucks.data ?? []).find((t) => t.id === load.truck_id);
  const driver = (drivers.data ?? []).find((d) => d.id === load.driver_id);
  const trailer = (trailers.data ?? []).find((t) => t.id === load.trailer_id);
  const [{ data: members }, { data: actors }] = await Promise.all([
    ctx.supabase
      .from("organization_members")
      .select("user_id, role, profiles!organization_members_user_id_fkey(full_name, email)")
      .eq("organization_id", carrier.data?.organization_id ?? "00000000-0000-0000-0000-000000000000")
      .eq("status", "active"),
    ctx.supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...new Set((history.data ?? []).map((h) => h.changed_by).filter((v): v is string => Boolean(v)))]),
  ]);
  const carrierUsers = members ?? [];
  const actorName = new Map((actors ?? []).map((p) => [p.id, p.full_name ?? p.email]));
  const first = stopRows[0];
  const last = stopRows[stopRows.length - 1];

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/dashboard/loads" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Loads
          </Link>
        }
        title={`Load ${load.reference}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <LoadStatusBadge status={status} />
            <Link href={`/dashboard/carriers/${load.carrier_id}`} className="font-medium underline-offset-2 hover:underline">
              {carrier.data?.legal_name}
            </Link>
            {first && last ? (
              <span>
                {first.city}, {first.state} → {last.city}, {last.state}
              </span>
            ) : null}
          </span>
        }
      />

      {load.status_note ? <p className="mb-4 text-sm text-steel-700">Latest update: {load.status_note}</p> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {!closed ? (
            <Card>
              <CardHeader>
                <CardTitle>Next step</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                {status === "opportunity" ? (
                  <p className="text-sm text-steel-700">
                    Confirm the rate, miles and stops, then send the load to the carrier. The carrier decides whether to take it.
                  </p>
                ) : null}
                {status === "proposed" ? (
                  <Alert tone="info" title="Waiting for the carrier's decision">
                    The carrier can approve or reject this load in the portal. If they decided by phone, text or email, record their
                    decision with the details.
                  </Alert>
                ) : null}
                {status === "approved" && blockers.length ? (
                  <Alert tone="warning" title="Before booking">
                    <ul className="list-disc pl-5">
                      {blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </Alert>
                ) : null}
                {(status === "delivered" || status === "paperwork_pending") && missingDocs.length ? (
                  <Alert tone="warning" title="Documents needed to complete">
                    {missingDocs.map((t) => DOCUMENT_TYPE_LABELS[t]).join(", ")}
                  </Alert>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {next.map((s) => (
                    <ActionForm
                      key={s}
                      action={changeLoadStatus}
                      submitLabel={NEXT_LABELS[s] ?? LOAD_STATUS_LABELS[s]}
                      submitVariant={s === "opportunity" ? "secondary" : "primary"}
                      inline
                    >
                      <input type="hidden" name="load_id" value={load.id} />
                      <input type="hidden" name="status" value={s} />
                    </ActionForm>
                  ))}
                  {status === "proposed" ? (
                    <FormDialog
                      title="Record carrier decision"
                      description="Use only when the carrier decided outside the portal. Record who decided, how and when."
                      triggerLabel="Record carrier decision"
                      triggerVariant="secondary"
                    >
                      <ActionForm action={recordCarrierDecision} submitLabel="Record decision">
                        <input type="hidden" name="load_id" value={load.id} />
                        <FormField id="decision" name="decision" label="Decision" required>
                          <Select name="decision" defaultValue="approved">
                            <option value="approved">Carrier approved at {formatMoney(load.gross_rate)}</option>
                            <option value="rejected">Carrier rejected</option>
                          </Select>
                        </FormField>
                        <FormField id="method" name="method" label="How they told us" required>
                          <Select name="method" defaultValue="phone">
                            <option value="phone">Phone call</option>
                            <option value="text_message">Text message</option>
                            <option value="email">Email</option>
                          </Select>
                        </FormField>
                        <FormField id="approver_user_id" name="approver_user_id" label="Carrier portal user (if any)">
                          <Select name="approver_user_id" defaultValue="">
                            <option value="">Not a portal user</option>
                            {carrierUsers.map((m) => (
                              <option key={m.user_id} value={m.user_id}>
                                {m.profiles?.full_name ?? m.profiles?.email}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                        <FormField id="approver_name" name="approver_name" label="Carrier representative's name" required>
                          <Input name="approver_name" maxLength={200} />
                        </FormField>
                        <FormField
                          id="decision-note"
                          name="note"
                          label="Evidence"
                          required
                          hint="For example: “Called owner at 2:15 PM; approved rate and pickup window.”"
                        >
                          <Textarea name="note" rows={3} maxLength={2000} />
                        </FormField>
                      </ActionForm>
                    </FormDialog>
                  ) : null}
                  {dispatcherNextStatuses(status).includes("cancelled") ? (
                    <ConfirmAction
                      action={cancelLoad}
                      title={`Cancel load ${load.reference}`}
                      description="Cancelled loads go back to the broker. They are never moved to another carrier."
                      triggerLabel="Cancel load"
                      triggerSize="md"
                      confirmLabel="Cancel load"
                    >
                      <input type="hidden" name="load_id" value={load.id} />
                      <FormField id="cancellation_disposition" name="cancellation_disposition" label="What happened" required>
                        <Select name="cancellation_disposition" defaultValue="returned_to_broker">
                          <option value="returned_to_broker">Returned to the broker</option>
                          <option value="broker_cancelled">Broker cancelled the load</option>
                        </Select>
                      </FormField>
                      <FormField id="cancellation_reason" name="cancellation_reason" label="Reason" required>
                        <Textarea name="cancellation_reason" rows={2} maxLength={1000} />
                      </FormField>
                      <p className="text-xs text-steel-600">
                        If the broker owes a TONU, add it as a charge before cancelling so it appears on the carrier&apos;s statement per
                        their fee terms.
                      </p>
                    </ConfirmAction>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {status === "cancelled" ? (
            <Alert
              tone="danger"
              title={`Cancelled — ${load.cancellation_disposition === "broker_cancelled" ? "broker cancelled" : "returned to broker"}`}
            >
              {load.cancellation_reason}
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Stops</CardTitle>
              {!closed ? (
                <FormDialog title="Add stop" triggerLabel="Add stop" triggerVariant="secondary" triggerSize="sm">
                  <StopForm loadId={load.id} timezone={timezone} />
                </FormDialog>
              ) : null}
            </CardHeader>
            <ol className="divide-y divide-steel-100">
              {stopRows.map((s) => (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p className="font-semibold">
                      {s.sequence}. {s.stop_type === "pickup" ? "Pickup" : "Delivery"} — {s.city}, {s.state}
                      {s.postal_code ? ` ${s.postal_code}` : ""}
                    </p>
                    <p className="text-steel-700">{[s.facility_name, s.address_line1].filter(Boolean).join(", ")}</p>
                    <p className="text-steel-600">
                      {s.appointment_type === "fcfs"
                        ? "First come, first served"
                        : s.appointment_type === "appointment"
                          ? "Appointment"
                          : "Window"}
                      {s.window_start ? `: ${formatDateTime(s.window_start, timezone)}` : ""}
                      {s.window_end ? ` – ${formatDateTime(s.window_end, timezone)}` : ""}
                    </p>
                    {s.contact_name || s.contact_phone ? (
                      <p className="text-steel-600">Contact: {[s.contact_name, s.contact_phone].filter(Boolean).join(" · ")}</p>
                    ) : null}
                    {s.instructions ? <p className="text-steel-600">{s.instructions}</p> : null}
                    {s.arrived_at ? <p className="text-xs text-success">Arrived {formatDateTime(s.arrived_at, timezone)}</p> : null}
                    {s.departed_at ? <p className="text-xs text-success">Departed {formatDateTime(s.departed_at, timezone)}</p> : null}
                  </div>
                  {!closed ? (
                    <div className="flex flex-wrap gap-2">
                      {["dispatched", "at_pickup", "loaded", "in_transit", "delivered"].includes(status) && !s.arrived_at ? (
                        <ActionForm action={recordStopTime} submitLabel="Arrived" submitVariant="secondary" submitSize="sm" inline>
                          <input type="hidden" name="load_id" value={load.id} />
                          <input type="hidden" name="stop_id" value={s.id} />
                          <input type="hidden" name="field" value="arrived_at" />
                        </ActionForm>
                      ) : null}
                      {s.arrived_at && !s.departed_at ? (
                        <ActionForm action={recordStopTime} submitLabel="Departed" submitVariant="secondary" submitSize="sm" inline>
                          <input type="hidden" name="load_id" value={load.id} />
                          <input type="hidden" name="stop_id" value={s.id} />
                          <input type="hidden" name="field" value="departed_at" />
                        </ActionForm>
                      ) : null}
                      <FormDialog title={`Edit stop ${s.sequence}`} triggerLabel="Edit" triggerVariant="ghost" triggerSize="sm">
                        <StopForm loadId={load.id} stop={s} timezone={timezone} />
                      </FormDialog>
                      {(status === "opportunity" || status === "proposed") && stopRows.length > 2 ? (
                        <ActionForm action={removeStop} submitLabel="Remove" submitVariant="ghost" submitSize="sm" inline>
                          <input type="hidden" name="load_id" value={load.id} />
                          <input type="hidden" name="stop_id" value={s.id} />
                        </ActionForm>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>

          {(vehicles.data ?? []).length || load.equipment_type === "car_hauler" ? (
            <Card>
              <CardHeader>
                <CardTitle>Vehicles ({(vehicles.data ?? []).length})</CardTitle>
                {!closed ? (
                  <FormDialog title="Add vehicle" triggerLabel="Add vehicle" triggerVariant="secondary" triggerSize="sm">
                    <VehicleForm loadId={load.id} stops={stopRows} />
                  </FormDialog>
                ) : null}
              </CardHeader>
              <ul className="divide-y divide-steel-100">
                {(vehicles.data ?? []).map((v) => (
                  <li key={v.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <p className="font-semibold">
                        {[v.year, v.make, v.model].filter(Boolean).join(" ") ||
                          VEHICLE_TYPE_LABELS[v.vehicle_type as keyof typeof VEHICLE_TYPE_LABELS] ||
                          "Vehicle"}
                        {!v.operable ? <span className="ml-2 text-xs text-warning">Inoperable</span> : null}
                      </p>
                      <p className="font-mono text-xs text-steel-600">{v.vin ? `VIN ${v.vin}` : "VIN not recorded"}</p>
                      <p className="text-steel-600">
                        {[
                          v.lot_number ? `Lot ${v.lot_number}` : null,
                          v.auction_or_dealer_name,
                          `Inspection: ${v.inspection_status.replace(/_/g, " ")}`,
                          `Paperwork: ${v.document_status}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {!closed ? (
                      <div className="flex gap-2">
                        <FormDialog title="Edit vehicle" triggerLabel="Edit" triggerVariant="ghost" triggerSize="sm">
                          <VehicleForm loadId={load.id} vehicle={v} stops={stopRows} />
                        </FormDialog>
                        <ActionForm action={removeVehicle} submitLabel="Remove" submitVariant="ghost" submitSize="sm" inline>
                          <input type="hidden" name="load_id" value={load.id} />
                          <input type="hidden" name="vehicle_id" value={v.id} />
                        </ActionForm>
                      </div>
                    ) : null}
                  </li>
                ))}
                {(vehicles.data ?? []).length === 0 ? <li className="px-5 py-3 text-sm text-steel-600">No vehicles recorded.</li> : null}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <FormDialog title="Upload load document" triggerLabel="Upload" triggerVariant="secondary" triggerSize="sm">
                <DocumentUploadForm
                  carrierId={load.carrier_id}
                  loadId={load.id}
                  types={LOAD_DOCUMENT_TYPES}
                  defaultType={missingDocs[0] ?? "rate_confirmation"}
                  allowInternal
                  idPrefix="load-doc"
                />
              </FormDialog>
            </CardHeader>
            <CardBody className="pb-0 text-sm text-steel-600">
              Required to complete: {load.required_documents.map((t) => DOCUMENT_TYPE_LABELS[t]).join(", ")}.
            </CardBody>
            {docRows.length ? (
              <DocumentTable
                documents={docRows}
                caption="Load documents"
                actions={(d) => <DocumentReviewActions doc={d} canArchive={admin} />}
              />
            ) : (
              <CardBody className="text-sm text-steel-600">No documents uploaded yet.</CardBody>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <ActionForm action={addLoadNote} submitLabel="Add note" submitSize="sm" resetOnSuccess>
                <input type="hidden" name="load_id" value={load.id} />
                <FormField id="note-body" name="body" label="New note">
                  <Textarea name="body" rows={2} maxLength={5000} />
                </FormField>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <Checkbox name="share_with_carrier" />
                    <span>Visible to the carrier</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox name="broker_credit" />
                    <span>Broker credit / payment note (always internal)</span>
                  </label>
                </div>
              </ActionForm>
              <ul className="space-y-3 text-sm">
                {(notes.data ?? []).map((n) => (
                  <li key={n.id} className="rounded-md border border-steel-200 p-3">
                    <p className="whitespace-pre-line">{n.body}</p>
                    <p className="mt-1 text-xs text-steel-600">
                      {n.profiles?.full_name ?? n.profiles?.email ?? "System"} · {formatDateTime(n.created_at, timezone)} ·{" "}
                      {n.kind === "broker_credit"
                        ? "broker credit (internal)"
                        : n.visibility === "carrier"
                          ? "shared with carrier"
                          : "internal"}
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
              <CardTitle>Rate and fee</CardTitle>
              {!closed ? (
                <FormDialog title="Edit load details" triggerLabel="Edit" triggerVariant="secondary" triggerSize="sm">
                  <LoadDetailsForm load={load} brokers={brokers.data ?? []} />
                </FormDialog>
              ) : null}
            </CardHeader>
            <CardBody className="space-y-4">
              <DetailList
                columns={1}
                items={[
                  [
                    "Gross rate (carrier revenue)",
                    <span key="g" className="text-lg font-semibold">
                      {formatMoney(load.gross_rate)}
                    </span>,
                  ],
                  ["Loaded / deadhead miles", `${formatMiles(load.loaded_miles)} / ${formatMiles(load.deadhead_miles)}`],
                  ["Rate per loaded mile", load.loaded_rate_per_mile !== null ? formatRate(load.loaded_rate_per_mile) : null],
                  ["All-in rate per mile", load.all_in_rate_per_mile !== null ? formatRate(load.all_in_rate_per_mile) : null],
                  [
                    "Equipment",
                    load.equipment_type ? (EQUIPMENT_LABELS[load.equipment_type as EquipmentKey] ?? load.equipment_type) : null,
                  ],
                  [
                    "Commodity",
                    [load.commodity, load.weight_lbs ? `${Number(load.weight_lbs).toLocaleString()} lb` : null].filter(Boolean).join(" · "),
                  ],
                ]}
              />
              <div className="rounded-md bg-paper-2 p-3 text-sm">
                {snapshot.data ? (
                  <>
                    <p className="font-semibold">Fee snapshot (final)</p>
                    <p>Eligible revenue {formatMoney(snapshot.data.eligible_revenue)}</p>
                    <p>
                      Dispatch fee {formatMoney(snapshot.data.dispatch_fee)}
                      {snapshot.data.fee_model === "flat_weekly" ? " (flat weekly plan: billed per truck on the weekly statement)" : ""}
                    </p>
                    <p className="text-xs text-steel-600">
                      Recorded {formatDateTime(snapshot.data.created_at, timezone)} for the week of {snapshot.data.statement_week}.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">Fee estimate</p>
                    <p>Eligible revenue {formatMoney(load.eligible_revenue)}</p>
                    <p>
                      {load.fee_model === "flat_weekly"
                        ? "Flat weekly plan — no per-load fee"
                        : `Estimated dispatch fee ${formatMoney(load.estimated_dispatch_fee)}`}
                    </p>
                    <p className="text-xs text-steel-600">Final fees are fixed when the load is completed.</p>
                  </>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Accessorials</h3>
                <ul className="space-y-1 text-sm">
                  {(charges.data ?? []).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span>
                        {CHARGE_TYPE_LABELS[c.charge_type]} {formatMoney(c.amount)}
                        {c.description ? <span className="block text-xs text-steel-600">{c.description}</span> : null}
                      </span>
                      {!closed ? (
                        <ActionForm action={removeCharge} submitLabel="Remove" submitVariant="ghost" submitSize="sm" inline>
                          <input type="hidden" name="load_id" value={load.id} />
                          <input type="hidden" name="charge_id" value={c.id} />
                        </ActionForm>
                      ) : null}
                    </li>
                  ))}
                  {(charges.data ?? []).length === 0 ? <li className="text-steel-600">None</li> : null}
                </ul>
                {!closed ? (
                  <FormDialog
                    title="Add accessorial charge"
                    description="Whether a charge counts toward the dispatch fee depends on the carrier's fee terms."
                    triggerLabel="Add charge"
                    triggerVariant="secondary"
                    triggerSize="sm"
                  >
                    <ActionForm action={addCharge} submitLabel="Add charge" resetOnSuccess>
                      <input type="hidden" name="load_id" value={load.id} />
                      <FormField id="charge_type" name="charge_type" label="Type" required>
                        <Select name="charge_type" defaultValue="detention">
                          {Constants.public.Enums.charge_type.map((t) => (
                            <option key={t} value={t}>
                              {CHARGE_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField id="charge_amount" name="amount" label="Amount ($)" required>
                        <Input name="amount" inputMode="decimal" />
                      </FormField>
                      <FormField id="charge_description" name="description" label="Description">
                        <Input name="description" maxLength={500} />
                      </FormField>
                    </ActionForm>
                  </FormDialog>
                ) : null}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Truck and driver</CardTitle>
              {!closed ? (
                <FormDialog title="Assign equipment" triggerLabel="Assign" triggerVariant="secondary" triggerSize="sm">
                  <AssignmentForm
                    load={load}
                    trucks={trucks.data ?? []}
                    trailers={trailers.data ?? []}
                    drivers={drivers.data ?? []}
                    dispatchers={dispatchers.map((d) => ({ user_id: d.user_id, label: staffLabel(d) }))}
                  />
                </FormDialog>
              ) : null}
            </CardHeader>
            <CardBody>
              <DetailList
                columns={1}
                items={[
                  [
                    "Truck",
                    truck?.unit_number ?? (
                      <span key="t" className="text-warning">
                        Not assigned
                      </span>
                    ),
                  ],
                  [
                    "Driver",
                    driver?.full_name ?? (
                      <span key="d" className="text-warning">
                        Not assigned
                      </span>
                    ),
                  ],
                  ["Trailer", trailer ? (TRAILER_TYPE_LABELS[trailer.trailer_type] ?? trailer.trailer_type) : null],
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Broker</CardTitle>
            </CardHeader>
            <CardBody>
              <DetailList
                columns={1}
                items={[
                  ["Broker", load.broker_name],
                  ["MC", load.broker_mc_number],
                  ["Contact", [load.broker_contact_name, load.broker_contact_phone, load.broker_contact_email].filter(Boolean).join(" · ")],
                  ["Broker load #", load.broker_load_number],
                ]}
              />
              <p className="mt-3 text-xs text-steel-600">
                The broker pays the carrier (or its factoring company) directly. We never receive or hold freight payments.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Carrier decisions</CardTitle>
            </CardHeader>
            <CardBody>
              {(approvals.data ?? []).length ? (
                <ul className="space-y-3 text-sm">
                  {approvals.data!.map((a) => (
                    <li key={a.id} className={a.superseded_at ? "text-steel-500" : undefined}>
                      <span className="font-semibold">{a.decision === "approved" ? "Approved" : "Rejected"}</span> by {a.approver_name} via{" "}
                      {a.method.replace("_", " ")} at {formatMoney(a.approved_gross_rate)}
                      <span className="block text-xs">
                        {formatDateTime(a.decided_at, timezone)}
                        {a.superseded_at ? " · superseded" : ""}
                      </span>
                      {a.note ? <span className="block text-xs">“{a.note}”</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-steel-600">No decision yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status history</CardTitle>
            </CardHeader>
            <CardBody>
              <ol className="space-y-2 text-sm">
                {(history.data ?? []).map((h) => (
                  <li key={h.id}>
                    <span className="font-medium">{LOAD_STATUS_LABELS[h.to_status as LoadStatus]}</span>
                    <span className="block text-xs text-steel-600">
                      {formatDateTime(h.changed_at, timezone)}
                      {h.changed_by && actorName.get(h.changed_by) ? ` · ${actorName.get(h.changed_by)}` : ""}
                    </span>
                    {h.note ? <span className="block text-xs text-steel-600">{h.note}</span> : null}
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
