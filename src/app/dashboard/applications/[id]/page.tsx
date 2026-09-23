import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approveApplication, declineApplication, markUnderReview, reopenApplication, requestInformation, saveInternalNotes } from "../actions";
import { ActionForm, ConfirmAction, FormDialog, FormField } from "@/components/action-form";
import { DocumentTable, type DocumentRow } from "@/components/dashboard/document-table";
import { StatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList } from "@/components/ui/detail-list";
import { Checkbox, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EQUIPMENT_LABELS, type EquipmentKey } from "@/config/business";
import { isAdminRole, requireStaff } from "@/lib/auth/session";
import { isUuid } from "@/lib/db/query";
import { formatDate, formatDateTime } from "@/lib/domain/dates";
import { describeFeeTerms, feeTermsFromRow } from "@/lib/domain/fees";
import { DAY_LABELS, FACTORING_LABELS, TRAILER_TYPE_LABELS } from "@/lib/domain/labels";
import { getApplicationQuestions } from "@/lib/settings";
import { listDispatchers, staffLabel } from "@/lib/staff";

export const metadata = { title: "Application" };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join(", ") : null);
const equipment = (v: unknown) => (typeof v === "string" ? (EQUIPMENT_LABELS[v as EquipmentKey] ?? v) : null);

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireStaff();
  const admin = isAdminRole(ctx.staffRoles);

  const { data: app } = await ctx.supabase
    .from("carrier_applications")
    .select(
      "id, status, email, contact_name, phone, legal_name, dba_name, mc_number, usdot_number, primary_equipment_type, truck_count, home_base_state, form_data, consent_version, consent_accepted_at, consent_ip, consent_user_agent, submitted_at, last_activity_at, created_at, reviewed_at, information_request, decision_reason, internal_notes, carrier_id, current_step, completed_steps, reviewer:profiles!carrier_applications_reviewed_by_fkey(full_name, email)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!app) notFound();

  const [docs, comms, plans, dispatchers, questions] = await Promise.all([
    ctx.supabase
      .from("documents")
      .select("id, doc_type, status, original_filename, size_bytes, expires_on, uploaded_at, review_note")
      .eq("application_id", id)
      .is("deleted_at", null)
      .neq("status", "uploading")
      .order("uploaded_at"),
    ctx.supabase.from("communications").select("id, template_key, subject, status, created_at, channel").eq("application_id", id).order("created_at", { ascending: false }).limit(20),
    ctx.supabase.from("fee_plans").select("key, name, model, percentage, flat_weekly_amount, is_default").eq("active", true).order("is_default", { ascending: false }),
    admin ? listDispatchers(ctx.supabase) : Promise.resolve([]),
    getApplicationQuestions(),
  ]);

  const fd = obj(app.form_data);
  const contact = obj(fd.contact);
  const business = obj(fd.business);
  const equip = obj(fd.equipment);
  const drivers = arr(obj(fd.drivers).drivers);
  const lanes = obj(fd.lanes);
  const prefs = obj(fd.preferences);
  const factoring = obj(fd.factoring);
  const documents = obj(fd.documents);
  const custom = obj(obj(fd.consent).custom);
  const reviewable = app.status === "submitted" || app.status === "under_review";

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/dashboard/applications" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Applications
          </Link>
        }
        title={app.legal_name || "Unnamed application"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={app.status} />
            {app.submitted_at ? <span>Submitted {formatDateTime(app.submitted_at)}</span> : <span>Draft started {formatDate(app.created_at)} · step {app.current_step} of 9</span>}
          </span>
        }
        actions={
          app.carrier_id ? (
            <Link href={`/dashboard/carriers/${app.carrier_id}`} className="inline-flex h-10 items-center rounded-md bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">
              Open carrier record
            </Link>
          ) : null
        }
      />

      {app.status === "information_requested" && app.information_request ? (
        <Alert tone="warning" title="Waiting on the applicant" className="mb-6">
          {app.information_request}
        </Alert>
      ) : null}
      {app.status === "declined" && app.decision_reason ? (
        <Alert tone="danger" title="Declined" className="mb-6">
          {app.decision_reason}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Contact and business</CardTitle>
            </CardHeader>
            <CardBody>
              <DetailList
                items={[
                  ["Contact", [str(contact.fullName), str(contact.title)].filter(Boolean).join(", ") || app.contact_name],
                  ["Email", app.email],
                  ["Phone", app.phone],
                  ["Preferred contact", str(contact.preferredContact)],
                  ["Legal name", app.legal_name],
                  ["DBA", app.dba_name],
                  ["MC number", app.mc_number],
                  ["USDOT number", app.usdot_number],
                  ["EIN (last four)", str(business.einLast4) ? `•••${str(business.einLast4)}` : null],
                  ["Years in business", str(business.yearsInBusiness)],
                  ["Authority active since", str(business.authorityActiveDate) ? formatDate(String(business.authorityActiveDate)) : null],
                  [
                    "Business address",
                    [str(business.addressLine1), str(business.addressLine2), [str(business.city), str(business.state), str(business.postalCode)].filter(Boolean).join(" ")]
                      .filter(Boolean)
                      .join(", "),
                  ],
                ]}
              />
              <p className="mt-4 text-xs text-steel-600">
                Verify authority, insurance and safety records directly with FMCSA before approving. Numbers entered by the applicant are unverified.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Equipment and drivers</CardTitle>
            </CardHeader>
            <CardBody className="space-y-5">
              <DetailList
                items={[
                  ["Primary equipment", equipment(equip.primaryEquipmentType)],
                  ["Other equipment", list(arr(equip.additionalEquipmentTypes).map((e) => equipment(e)))],
                  ["Trucks", str(equip.truckCount)],
                  ["Equipment notes", str(equip.notes)],
                ]}
              />
              <div>
                <h3 className="mb-2 text-sm font-semibold">Trucks</h3>
                <ul className="divide-y divide-steel-100 rounded-md border border-steel-200 text-sm">
                  {arr(equip.trucks).map((t, i) => (
                    <li key={i} className="px-3 py-2">
                      <span className="font-medium">{str(t.unitNumber) ?? `Truck ${i + 1}`}</span> · {equipment(t.equipmentType)}
                      {[str(t.year), str(t.make), str(t.model)].filter(Boolean).length ? ` · ${[t.year, t.make, t.model].filter(Boolean).join(" ")}` : ""}
                      {str(t.vehicleCapacity) ? ` · ${t.vehicleCapacity} vehicles` : ""}
                      {str(t.maxPayloadLbs) ? ` · ${Number(t.maxPayloadLbs).toLocaleString()} lb payload` : ""}
                    </li>
                  ))}
                  {arr(equip.trucks).length === 0 ? <li className="px-3 py-2 text-steel-600">None listed</li> : null}
                </ul>
              </div>
              {arr(equip.trailers).length ? (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Trailers</h3>
                  <ul className="divide-y divide-steel-100 rounded-md border border-steel-200 text-sm">
                    {arr(equip.trailers).map((t, i) => (
                      <li key={i} className="px-3 py-2">
                        {TRAILER_TYPE_LABELS[String(t.trailerType)] ?? str(t.trailerType)}
                        {str(t.lengthFt) ? ` · ${t.lengthFt} ft` : ""}
                        {str(t.vehicleCapacity) ? ` · ${t.vehicleCapacity} vehicles` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <h3 className="mb-2 text-sm font-semibold">Drivers</h3>
                <ul className="divide-y divide-steel-100 rounded-md border border-steel-200 text-sm">
                  {drivers.map((d, i) => (
                    <li key={i} className="px-3 py-2">
                      <span className="font-medium">{str(d.fullName)}</span>
                      {d.isOwnerOperator ? " · owner-operator" : ""}
                      {str(d.phone) ? ` · ${d.phone}` : ""}
                      {str(d.email) ? ` · ${d.email}` : ""}
                    </li>
                  ))}
                  {drivers.length === 0 ? <li className="px-3 py-2 text-steel-600">None listed</li> : null}
                </ul>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lanes, schedule and payment</CardTitle>
            </CardHeader>
            <CardBody>
              <DetailList
                items={[
                  ["Home base", [str(lanes.homeBaseCity), str(lanes.homeBaseState)].filter(Boolean).join(", ")],
                  ["Preferred states", list(lanes.preferredStates)],
                  ["Avoid states", list(lanes.avoidStates)],
                  ["Preferred lanes", arr(lanes.preferredLanes).map((l) => `${l.originState} → ${l.destinationState}`).join(", ") || null],
                  ["Minimum rate", str(prefs.minRatePerMile) ? `$${Number(prefs.minRatePerMile).toFixed(2)} per loaded mile` : null],
                  ["Desired weekly gross", str(prefs.desiredWeeklyGross) ? `$${Number(prefs.desiredWeeklyGross).toLocaleString()}` : null],
                  ["Days available", list(arr(prefs.daysAvailable).map((d) => DAY_LABELS[String(d)] ?? String(d)))],
                  ["Max deadhead", str(prefs.maxDeadheadMiles) ? `${prefs.maxDeadheadMiles} miles` : null],
                  ["How they are paid", FACTORING_LABELS[String(factoring.status ?? "unknown")] ?? str(factoring.status)],
                  ["Factoring company", str(factoring.companyName)],
                  ["Notice of assignment available", factoring.status === "factoring" ? (factoring.noaAvailable ? "Yes" : "No") : null],
                  ["Insurance expiration (stated)", str(documents.insuranceExpirationDate) ? formatDate(String(documents.insuranceExpirationDate)) : null],
                  ["Lane notes", str(lanes.notes)],
                  ["Schedule notes", str(prefs.notes)],
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Uploaded documents</CardTitle>
            </CardHeader>
            {docs.data && docs.data.length ? (
              <DocumentTable documents={docs.data as DocumentRow[]} caption="Application documents" />
            ) : (
              <CardBody className="text-sm text-steel-600">No documents uploaded.</CardBody>
            )}
          </Card>

          {questions.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Additional questions</CardTitle>
              </CardHeader>
              <CardBody>
                <DetailList columns={1} items={questions.map((q) => [q.label, str(custom[q.id])])} />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Consent record</CardTitle>
            </CardHeader>
            <CardBody>
              <DetailList
                items={[
                  ["Consent version", app.consent_version],
                  ["Accepted", app.consent_accepted_at ? formatDateTime(app.consent_accepted_at) : null],
                  ["IP address", app.consent_ip ? String(app.consent_ip) : null],
                  ["Browser", app.consent_user_agent],
                ]}
              />
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Decision</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <DetailList
                columns={1}
                items={[
                  ["Last reviewed", app.reviewed_at ? `${formatDateTime(app.reviewed_at)}${app.reviewer ? ` by ${app.reviewer.full_name ?? app.reviewer.email}` : ""}` : "Not yet"],
                  ["Decision note", app.decision_reason],
                ]}
              />
              {!admin ? <p className="text-sm text-steel-600">Only administrators can approve or decline applications.</p> : null}
              {admin && app.status === "submitted" ? (
                <ActionForm action={markUnderReview} submitLabel="Start review" submitVariant="secondary" inline>
                  <input type="hidden" name="id" value={app.id} />
                </ActionForm>
              ) : null}
              {admin && reviewable ? (
                <div className="flex flex-wrap gap-2">
                  <FormDialog title="Approve application" description="Creates the carrier record, fleet, lanes and fee terms from this application. Dispatching starts only after onboarding is complete." triggerLabel="Approve" triggerSize="sm">
                    <ActionForm action={approveApplication} submitLabel="Approve and create carrier" pendingLabel="Approving…">
                      <input type="hidden" name="id" value={app.id} />
                      <FormField id="fee_plan_key" name="fee_plan_key" label="Dispatch fee plan" required>
                        <Select name="fee_plan_key" defaultValue={plans.data?.find((p) => p.is_default)?.key}>
                          {(plans.data ?? []).map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.name} — {describeFeeTerms(feeTermsFromRow(p))}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField id="dispatcher_id" name="dispatcher_id" label="Primary dispatcher" hint="You can also assign one later.">
                        <Select name="dispatcher_id" defaultValue="">
                          <option value="">Assign later</option>
                          {dispatchers.map((d) => (
                            <option key={d.user_id} value={d.user_id}>
                              {staffLabel(d)}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField id="approve-note" name="note" label="Approval note (internal)">
                        <Textarea name="note" rows={2} maxLength={2000} />
                      </FormField>
                      <label className="flex items-start gap-2 text-sm">
                        <Checkbox name="send_invitation" defaultChecked />
                        <span>Email a portal invitation to {app.email ?? "the applicant"} now</span>
                      </label>
                    </ActionForm>
                  </FormDialog>
                  <FormDialog title="Request more information" description="The applicant gets an email with a new private link to update their application." triggerLabel="Request info" triggerVariant="secondary" triggerSize="sm">
                    <ActionForm action={requestInformation} submitLabel="Send request">
                      <input type="hidden" name="id" value={app.id} />
                      <FormField id="request" name="request" label="What do you need?" required hint="This text is sent to the applicant.">
                        <Textarea name="request" rows={4} maxLength={4000} placeholder="Please upload a certificate of insurance that lists the current policy period." />
                      </FormField>
                    </ActionForm>
                  </FormDialog>
                  <ConfirmAction action={declineApplication} title="Decline application" description="The reason is kept internally. The applicant email does not include it." triggerLabel="Decline" confirmLabel="Decline application">
                    <input type="hidden" name="id" value={app.id} />
                    <FormField id="reason" name="reason" label="Reason (internal)" required>
                      <Textarea name="reason" rows={3} maxLength={2000} />
                    </FormField>
                    <label className="flex items-start gap-2 text-sm">
                      <Checkbox name="notify" defaultChecked />
                      <span>Send the applicant a polite decline email</span>
                    </label>
                  </ConfirmAction>
                </div>
              ) : null}
              {admin && app.status === "declined" ? (
                <ActionForm action={reopenApplication} submitLabel="Reopen for review" submitVariant="secondary" inline>
                  <input type="hidden" name="id" value={app.id} />
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>

          {admin ? (
            <Card>
              <CardHeader>
                <CardTitle>Internal notes</CardTitle>
              </CardHeader>
              <CardBody>
                <ActionForm action={saveInternalNotes} submitLabel="Save notes" submitVariant="secondary" submitSize="sm" successMessage="Notes saved.">
                  <input type="hidden" name="id" value={app.id} />
                  <FormField id="internal_notes" name="internal_notes" label="Notes (never shown to the carrier)">
                    <Textarea name="internal_notes" rows={5} maxLength={8000} defaultValue={app.internal_notes ?? ""} />
                  </FormField>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Emails</CardTitle>
            </CardHeader>
            <CardBody>
              {comms.data && comms.data.length ? (
                <ul className="space-y-2 text-sm">
                  {comms.data.map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-2">
                      <span>
                        {c.subject ?? c.template_key}
                        <span className="block text-xs text-steel-600">{formatDateTime(c.created_at)}</span>
                      </span>
                      <StatusBadge status={c.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-steel-600">No emails yet.</p>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
