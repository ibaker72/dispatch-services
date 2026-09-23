import type { CarrierTabProps } from "./types";
import { assignDispatcher, changeFeeContract, endAssignment, setAuthorityVerification, setCarrierStatus, updateCarrierDetails } from "../../actions";
import { ActionForm, ConfirmAction, FormDialog, FormField } from "@/components/action-form";
import { OnboardingChecklist, parseOnboarding } from "@/components/onboarding-checklist";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList } from "@/components/ui/detail-list";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { addDays, formatDate, formatDateTime, localDate } from "@/lib/domain/dates";
import { describeFeeTerms, feeTermsFromRow } from "@/lib/domain/fees";
import { DAY_LABELS, FACTORING_LABELS } from "@/lib/domain/labels";
import { getOperationsSettings } from "@/lib/settings";
import { listDispatchers, staffLabel } from "@/lib/staff";
import { US_STATES } from "@/lib/utils";

export async function OverviewTab({ ctx, carrier, admin }: CarrierTabProps) {
  const { timezone } = await getOperationsSettings();
  const today = localDate(new Date(), timezone);
  const [onboardingRes, contracts, assignments, plans, dispatchers] = await Promise.all([
    ctx.supabase.rpc("get_carrier_onboarding", { p_carrier_id: carrier.id }),
    ctx.supabase
      .from("carrier_fee_contracts")
      .select("*, fee_plans(name)")
      .eq("carrier_id", carrier.id)
      .order("effective_from", { ascending: false }),
    ctx.supabase
      .from("dispatcher_assignments")
      .select("id, is_primary, note, assigned_at, profiles!dispatcher_assignments_dispatcher_id_fkey(full_name, email)")
      .eq("carrier_id", carrier.id)
      .is("ended_at", null)
      .order("is_primary", { ascending: false }),
    admin ? ctx.supabase.from("fee_plans").select("id, key, name, model, percentage, flat_weekly_amount, is_default").eq("active", true) : Promise.resolve({ data: [] }),
    admin ? listDispatchers(ctx.supabase) : Promise.resolve([]),
  ]);
  const onboarding = parseOnboarding(onboardingRes.data);
  const currentContract = (contracts.data ?? []).find((c) => c.effective_from <= today && (!c.effective_to || c.effective_to > today));
  const upcoming = (contracts.data ?? []).filter((c) => c.effective_from > today);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Company and preferences</CardTitle>
            <FormDialog title="Edit carrier details" description="Legal name, authority numbers and EIN come from the approved application and are changed only by an administrator via support." triggerLabel="Edit" triggerVariant="secondary" triggerSize="sm">
              <ActionForm action={updateCarrierDetails} submitLabel="Save details">
                <input type="hidden" name="carrier_id" value={carrier.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField id="dba_name" name="dba_name" label="DBA">
                    <Input name="dba_name" defaultValue={carrier.dba_name ?? ""} />
                  </FormField>
                  <FormField id="c-email" name="email" label="Company email">
                    <Input name="email" type="email" defaultValue={carrier.email ?? ""} />
                  </FormField>
                  <FormField id="c-phone" name="phone" label="Company phone">
                    <Input name="phone" type="tel" defaultValue={carrier.phone ?? ""} />
                  </FormField>
                  <FormField id="address_line1" name="address_line1" label="Street address">
                    <Input name="address_line1" defaultValue={carrier.address_line1 ?? ""} />
                  </FormField>
                  <FormField id="address_line2" name="address_line2" label="Address line 2">
                    <Input name="address_line2" defaultValue={carrier.address_line2 ?? ""} />
                  </FormField>
                  <FormField id="city" name="city" label="City">
                    <Input name="city" defaultValue={carrier.city ?? ""} />
                  </FormField>
                  <FormField id="state" name="state" label="State">
                    <Select name="state" defaultValue={carrier.state ?? ""}>
                      <option value="">—</option>
                      {US_STATES.map(([c, n]) => (
                        <option key={c} value={c}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField id="postal_code" name="postal_code" label="ZIP">
                    <Input name="postal_code" defaultValue={carrier.postal_code ?? ""} />
                  </FormField>
                  <FormField id="home_base_city" name="home_base_city" label="Home base city">
                    <Input name="home_base_city" defaultValue={carrier.home_base_city ?? ""} />
                  </FormField>
                  <FormField id="home_base_state" name="home_base_state" label="Home base state">
                    <Select name="home_base_state" defaultValue={carrier.home_base_state ?? ""}>
                      <option value="">—</option>
                      {US_STATES.map(([c, n]) => (
                        <option key={c} value={c}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField id="insurance_expiration_date" name="insurance_expiration_date" label="Insurance expires" hint="Updated automatically when a certificate of insurance is accepted.">
                    <Input name="insurance_expiration_date" type="date" defaultValue={carrier.insurance_expiration_date ?? ""} />
                  </FormField>
                  <FormField id="factoring_status" name="factoring_status" label="How the carrier is paid">
                    <Select name="factoring_status" defaultValue={carrier.factoring_status}>
                      {Object.entries(FACTORING_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField id="factoring_company_name" name="factoring_company_name" label="Factoring company">
                    <Input name="factoring_company_name" defaultValue={carrier.factoring_company_name ?? ""} />
                  </FormField>
                  <FormField id="min_rate_per_mile" name="min_rate_per_mile" label="Minimum rate per mile">
                    <Input name="min_rate_per_mile" inputMode="decimal" defaultValue={carrier.min_rate_per_mile ?? ""} />
                  </FormField>
                  <FormField id="max_deadhead_miles" name="max_deadhead_miles" label="Max deadhead miles">
                    <Input name="max_deadhead_miles" inputMode="numeric" defaultValue={carrier.max_deadhead_miles ?? ""} />
                  </FormField>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox name="noa_on_file" defaultChecked={carrier.noa_on_file} />
                  <span>Notice of assignment on file</span>
                </label>
                <FormField id="preferences_notes" name="preferences_notes" label="Operating notes">
                  <Textarea name="preferences_notes" rows={3} defaultValue={carrier.preferences_notes ?? ""} />
                </FormField>
              </ActionForm>
            </FormDialog>
          </CardHeader>
          <CardBody>
            <DetailList
              items={[
                ["Email", carrier.email],
                ["Phone", carrier.phone],
                ["Address", [carrier.address_line1, carrier.address_line2, [carrier.city, carrier.state, carrier.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ")],
                ["Home base", [carrier.home_base_city, carrier.home_base_state].filter(Boolean).join(", ")],
                ["EIN (last four)", carrier.ein_last4 ? `•••${carrier.ein_last4}` : null],
                ["Years in business", carrier.years_in_business],
                ["Minimum rate", carrier.min_rate_per_mile ? `$${Number(carrier.min_rate_per_mile).toFixed(2)} per loaded mile` : null],
                ["Max deadhead", carrier.max_deadhead_miles ? `${carrier.max_deadhead_miles} miles` : null],
                ["Days available", carrier.days_available.map((d) => DAY_LABELS[d] ?? d).join(", ")],
                ["Desired weekly gross", carrier.desired_weekly_gross ? `$${Number(carrier.desired_weekly_gross).toLocaleString()}` : null],
                ["How they are paid", `${FACTORING_LABELS[carrier.factoring_status] ?? carrier.factoring_status}${carrier.factoring_company_name ? ` — ${carrier.factoring_company_name}` : ""}`],
                ["Notice of assignment", carrier.noa_on_file ? "On file" : "Not on file"],
                ["Insurance expires", carrier.insurance_expiration_date ? formatDate(carrier.insurance_expiration_date) : null],
                ["Notes", carrier.preferences_notes],
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dispatch fee terms</CardTitle>
            {admin ? (
              <FormDialog title="Change fee terms" description="Terms are recorded as a new contract version starting on the date you choose. Loads completed earlier keep their fee snapshots." triggerLabel="Change terms" triggerVariant="secondary" triggerSize="sm">
                <ActionForm action={changeFeeContract} submitLabel="Record new terms">
                  <input type="hidden" name="carrier_id" value={carrier.id} />
                  <FormField id="fee_plan_id" name="fee_plan_id" label="Fee plan" required>
                    <Select name="fee_plan_id" defaultValue={currentContract?.fee_plan_id ?? ""}>
                      {(plans.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {describeFeeTerms(feeTermsFromRow(p))}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField id="effective_from" name="effective_from" label="Effective from" required>
                    <Input name="effective_from" type="date" defaultValue={addDays(today, 1)} />
                  </FormField>
                  <details className="rounded-md border border-steel-200 p-3 text-sm">
                    <summary className="cursor-pointer font-semibold">Negotiated terms (optional)</summary>
                    <div className="mt-3 space-y-3">
                      <label className="flex items-start gap-2">
                        <Checkbox name="custom_terms" />
                        <span>Use the terms below instead of the plan&apos;s standard terms</span>
                      </label>
                      <FormField id="model" name="model" label="Fee model">
                        <Select name="model" defaultValue="percentage">
                          <option value="percentage">Percentage of eligible revenue</option>
                          <option value="flat_weekly">Flat weekly per active truck</option>
                        </Select>
                      </FormField>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FormField id="percentage_display" name="percentage_display" label="Percentage (%)">
                          <Input name="percentage_display" inputMode="decimal" placeholder="7" />
                        </FormField>
                        <FormField id="flat_weekly_amount" name="flat_weekly_amount" label="Weekly amount per truck ($)">
                          <Input name="flat_weekly_amount" inputMode="decimal" placeholder="300.00" />
                        </FormField>
                      </div>
                      <fieldset>
                        <legend className="font-semibold">Accessorials included in eligible revenue</legend>
                        {(["detention", "layover", "tonu", "other"] as const).map((k) => (
                          <label key={k} className="mt-1 flex items-center gap-2">
                            <Checkbox name={`include_${k}`} />
                            <span>{k === "tonu" ? "TONU" : k[0]!.toUpperCase() + k.slice(1)}</span>
                          </label>
                        ))}
                      </fieldset>
                    </div>
                  </details>
                  <FormField id="fee-notes" name="notes" label="Reason for change" required hint="For example: signed amendment dated …">
                    <Textarea name="notes" rows={2} />
                  </FormField>
                </ActionForm>
              </FormDialog>
            ) : null}
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            {currentContract ? (
              <p>
                <span className="font-semibold">{describeFeeTerms(feeTermsFromRow(currentContract))}</span>
                <span className="block text-steel-600">
                  {currentContract.fee_plans?.name} · since {formatDate(currentContract.effective_from)}
                  {currentContract.effective_to ? ` · until ${formatDate(currentContract.effective_to)}` : ""}
                  {" · "}
                  Accessorials counted:{" "}
                  {[currentContract.include_detention && "detention", currentContract.include_layover && "layover", currentContract.include_tonu && "TONU", currentContract.include_other && "other"]
                    .filter(Boolean)
                    .join(", ") || "none"}
                </span>
              </p>
            ) : (
              <p className="text-warning">No fee terms in force today.</p>
            )}
            {upcoming.map((c) => (
              <p key={c.id} className="text-steel-700">
                Scheduled: {describeFeeTerms(feeTermsFromRow(c))} from {formatDate(c.effective_from)}
              </p>
            ))}
            {(contracts.data ?? []).length > 1 ? (
              <details>
                <summary className="cursor-pointer text-steel-700">Term history ({contracts.data!.length})</summary>
                <ul className="mt-2 space-y-1 text-steel-700">
                  {contracts.data!.map((c) => (
                    <li key={c.id}>
                      {formatDate(c.effective_from)} – {c.effective_to ? formatDate(c.effective_to) : "open"}: {describeFeeTerms(feeTermsFromRow(c))}
                      {c.notes ? ` (${c.notes})` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operating authority verification</CardTitle>
            <StatusBadge status={carrier.authority_verification_status} />
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <DetailList
              items={[
                ["MC number", carrier.mc_number],
                ["USDOT number", carrier.usdot_number],
                ["Authority active since", carrier.authority_active_date ? formatDate(carrier.authority_active_date) : null],
                ["Verified", carrier.authority_verified_at ? formatDateTime(carrier.authority_verified_at, timezone) : null],
                ["Verification notes", carrier.authority_verification_notes],
              ]}
            />
            <p className="text-xs text-steel-600">
              Check active authority, insurance on file and safety status in FMCSA systems. Record what you checked; the carrier cannot be activated until this is verified.
            </p>
            {admin ? (
              <FormDialog title="Record authority verification" triggerLabel="Record verification" triggerVariant="secondary" triggerSize="sm">
                <ActionForm action={setAuthorityVerification} submitLabel="Save verification">
                  <input type="hidden" name="carrier_id" value={carrier.id} />
                  <FormField id="authority_verification_status" name="authority_verification_status" label="Result" required>
                    <Select name="authority_verification_status" defaultValue={carrier.authority_verification_status}>
                      <option value="verified">Verified — authority active</option>
                      <option value="failed">Failed — not active or mismatch</option>
                      <option value="unverified">Not verified yet</option>
                    </Select>
                  </FormField>
                  <FormField id="authority_active_date" name="authority_active_date" label="Authority active since">
                    <Input name="authority_active_date" type="date" defaultValue={carrier.authority_active_date ?? ""} />
                  </FormField>
                  <FormField id="authority_verification_notes" name="authority_verification_notes" label="What you checked" required>
                    <Textarea name="authority_verification_notes" rows={3} placeholder="FMCSA registration shows authority active; insurance on file; checked on …" defaultValue={carrier.authority_verification_notes ?? ""} />
                  </FormField>
                </ActionForm>
              </FormDialog>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <aside className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Onboarding</CardTitle>
            <StatusBadge status={carrier.status} />
          </CardHeader>
          <CardBody className="space-y-4">
            <OnboardingChecklist steps={onboarding.steps} />
            {admin && carrier.status !== "active" ? (
              <ActionForm action={setCarrierStatus} submitLabel="Activate dispatch service" inline>
                <input type="hidden" name="carrier_id" value={carrier.id} />
                <input type="hidden" name="status" value="active" />
              </ActionForm>
            ) : null}
            {admin && carrier.status !== "active" && !onboarding.complete ? (
              <p className="text-xs text-steel-600">Activation is refused by the database until every item above is complete.</p>
            ) : null}
            {admin && carrier.status === "active" ? (
              <ConfirmAction action={setCarrierStatus} title="Deactivate carrier" description="Dispatch stops for this carrier. Open loads stay visible and must be completed or cancelled." triggerLabel="Deactivate" confirmLabel="Deactivate carrier">
                <input type="hidden" name="carrier_id" value={carrier.id} />
                <input type="hidden" name="status" value="inactive" />
              </ConfirmAction>
            ) : null}
            {carrier.activated_at ? <p className="text-xs text-steel-600">Activated {formatDateTime(carrier.activated_at, timezone)}</p> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dispatchers</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {(assignments.data ?? []).length ? (
              <ul className="space-y-2 text-sm">
                {assignments.data!.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2">
                    <span>
                      <span className="font-medium">{a.profiles ? (a.profiles.full_name ?? a.profiles.email) : "Unknown"}</span>
                      {a.is_primary ? <span className="ml-1 text-xs text-steel-600">(primary)</span> : null}
                      <span className="block text-xs text-steel-600">since {formatDate(a.assigned_at)}</span>
                    </span>
                    {admin ? (
                      <ActionForm action={endAssignment} submitLabel="End" submitVariant="ghost" submitSize="sm" inline>
                        <input type="hidden" name="assignment_id" value={a.id} />
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-warning">No dispatcher assigned.</p>
            )}
            {admin ? (
              <FormDialog title="Assign dispatcher" triggerLabel="Assign dispatcher" triggerVariant="secondary" triggerSize="sm">
                <ActionForm action={assignDispatcher} submitLabel="Assign">
                  <input type="hidden" name="carrier_id" value={carrier.id} />
                  <FormField id="dispatcher_id" name="dispatcher_id" label="Dispatcher" required>
                    <Select name="dispatcher_id" defaultValue="">
                      <option value="" disabled>
                        Choose…
                      </option>
                      {dispatchers.map((d) => (
                        <option key={d.user_id} value={d.user_id}>
                          {staffLabel(d)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox name="is_primary" defaultChecked={!(assignments.data ?? []).some((a) => a.is_primary)} />
                    <span>Primary dispatcher</span>
                  </label>
                  <FormField id="assign-note" name="note" label="Note">
                    <Input name="note" maxLength={1000} />
                  </FormField>
                </ActionForm>
              </FormDialog>
            ) : null}
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}
