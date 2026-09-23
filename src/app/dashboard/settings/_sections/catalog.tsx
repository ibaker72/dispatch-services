import { addApplicationQuestion, removeApplicationQuestion, saveDocumentRequirement, saveEquipmentType, saveFeePlan } from "../actions";
import { ActionForm, FormDialog, FormField } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import type { Tables } from "@/lib/db/database.types";
import { describeFeeTerms, feeTermsFromRow } from "@/lib/domain/fees";
import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/labels";
import { getApplicationQuestions } from "@/lib/settings";
import type { UserSupabaseClient } from "@/lib/supabase/server";

function FeePlanForm({ plan }: { plan?: Tables<"fee_plans"> }) {
  const p = (s: string) => `plan-${plan?.id ?? "new"}-${s}`;
  return (
    <ActionForm action={saveFeePlan} submitLabel={plan ? "Save plan" : "Create plan"}>
      {plan ? <input type="hidden" name="id" value={plan.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {!plan ? (
          <FormField id={p("key")} name="key" label="Key" required hint="Permanent identifier, e.g. premium_percentage">
            <Input name="key" maxLength={40} />
          </FormField>
        ) : null}
        <FormField id={p("name")} name="name" label="Name" required>
          <Input name="name" defaultValue={plan?.name} maxLength={120} />
        </FormField>
        <FormField id={p("model")} name="model" label="Model">
          <Select name="model" defaultValue={plan?.model ?? "percentage"}>
            <option value="percentage">Percentage of eligible revenue</option>
            <option value="flat_weekly">Flat weekly per active truck</option>
          </Select>
        </FormField>
        <FormField id={p("pct")} name="percentage_display" label="Percentage (%)">
          <Input name="percentage_display" inputMode="decimal" defaultValue={plan?.percentage ? (Number(plan.percentage) * 100).toString() : ""} />
        </FormField>
        <FormField id={p("flat")} name="flat_weekly_amount" label="Weekly amount per truck ($)">
          <Input name="flat_weekly_amount" inputMode="decimal" defaultValue={plan?.flat_weekly_amount ? Number(plan.flat_weekly_amount).toFixed(2) : ""} />
        </FormField>
      </div>
      <FormField id={p("desc")} name="description" label="Description">
        <Textarea name="description" rows={2} defaultValue={plan?.description ?? ""} maxLength={1000} />
      </FormField>
      <fieldset className="space-y-1 text-sm">
        <legend className="font-semibold">Accessorials counted toward eligible revenue</legend>
        {(["detention", "layover", "tonu", "other"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <Checkbox name={`include_${k}`} defaultChecked={plan ? plan[`include_${k}`] : k !== "other"} />
            <span>{k === "tonu" ? "TONU" : k[0]!.toUpperCase() + k.slice(1)}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox name="active" defaultChecked={plan?.active ?? true} />
          <span>Available for new carriers</span>
        </label>
        <label className="flex items-center gap-2">
          <Checkbox name="is_default" defaultChecked={plan?.is_default ?? false} />
          <span>Default plan</span>
        </label>
      </div>
      <p className="text-xs text-steel-600">Changing a plan affects new fee contracts only. Existing carriers keep their recorded terms; completed loads keep their fee snapshots.</p>
    </ActionForm>
  );
}

export async function PricingSection({ supabase }: { supabase: UserSupabaseClient }) {
  const { data: plans } = await supabase.from("fee_plans").select("*").order("is_default", { ascending: false }).order("name");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dispatch fee plans</CardTitle>
        <FormDialog title="New fee plan" triggerLabel="New plan" triggerVariant="secondary" triggerSize="sm">
          <FeePlanForm />
        </FormDialog>
      </CardHeader>
      <ul className="divide-y divide-steel-100">
        {(plans ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
            <div>
              <p className="font-semibold">
                {p.name} {p.is_default ? <Badge tone="accent">Default</Badge> : null} {!p.active ? <Badge>Inactive</Badge> : null}
              </p>
              <p className="text-steel-700">{describeFeeTerms(feeTermsFromRow(p))}</p>
              {p.description ? <p className="text-xs text-steel-600">{p.description}</p> : null}
            </div>
            <FormDialog title={`Edit ${p.name}`} triggerLabel="Edit" triggerVariant="secondary" triggerSize="sm">
              <FeePlanForm plan={p} />
            </FormDialog>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export async function EquipmentSection({ supabase }: { supabase: UserSupabaseClient }) {
  const { data } = await supabase.from("equipment_types").select("*").order("sort_order");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Equipment types</CardTitle>
      </CardHeader>
      <ul className="divide-y divide-steel-100">
        {(data ?? []).map((e) => (
          <li key={e.key} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
            <div>
              <p className="font-semibold">
                {e.label} {e.is_primary ? <Badge tone="accent">Primary</Badge> : null} {!e.active ? <Badge>Hidden</Badge> : null}
              </p>
              <p className="text-xs text-steel-600">{e.description}</p>
            </div>
            <FormDialog title={`Edit ${e.label}`} triggerLabel="Edit" triggerVariant="secondary" triggerSize="sm">
              <ActionForm action={saveEquipmentType} submitLabel="Save">
                <input type="hidden" name="key" value={e.key} />
                <FormField id={`eq-${e.key}-label`} name="label" label="Label" required>
                  <Input name="label" defaultValue={e.label} maxLength={80} />
                </FormField>
                <FormField id={`eq-${e.key}-desc`} name="description" label="Description">
                  <Textarea name="description" rows={2} defaultValue={e.description ?? ""} maxLength={500} />
                </FormField>
                <FormField id={`eq-${e.key}-sort`} name="sort_order" label="Sort order">
                  <Input name="sort_order" type="number" defaultValue={e.sort_order} />
                </FormField>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox name="active" defaultChecked={e.active} />
                  <span>Offered on the application form</span>
                </label>
              </ActionForm>
            </FormDialog>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export async function ApplicationSection({ supabase }: { supabase: UserSupabaseClient }) {
  const [questions, { data: reqs }] = await Promise.all([getApplicationQuestions(), supabase.from("document_requirements").select("*").order("sort_order")]);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Additional application questions</CardTitle>
          <FormDialog title="Add question" triggerLabel="Add question" triggerVariant="secondary" triggerSize="sm">
            <ActionForm action={addApplicationQuestion} submitLabel="Add question">
              <FormField id="q-label" name="label" label="Question" required hint="Do not ask for Social Security numbers, bank credentials or other sensitive identifiers.">
                <Input name="label" maxLength={200} />
              </FormField>
              <FormField id="q-type" name="type" label="Answer type">
                <Select name="type" defaultValue="text">
                  <option value="text">Short text</option>
                  <option value="textarea">Paragraph</option>
                  <option value="yes_no">Yes / no</option>
                  <option value="select">Choose one</option>
                </Select>
              </FormField>
              <FormField id="q-options" name="options" label="Options (one per line, for “Choose one”)">
                <Textarea name="options" rows={3} />
              </FormField>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="required" />
                <span>Required</span>
              </label>
            </ActionForm>
          </FormDialog>
        </CardHeader>
        {questions.length ? (
          <ul className="divide-y divide-steel-100">
            {questions.map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>
                  <span className="font-medium">{q.label}</span>
                  <span className="block text-xs text-steel-600">
                    {q.type.replace("_", "/")}
                    {q.required ? " · required" : ""}
                    {q.options?.length ? ` · ${q.options.join(", ")}` : ""}
                  </span>
                </span>
                <ActionForm action={removeApplicationQuestion} submitLabel="Remove" submitVariant="ghost" submitSize="sm" inline>
                  <input type="hidden" name="id" value={q.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : (
          <CardBody className="text-sm text-steel-600">No additional questions. The standard application covers contact, authority, equipment, drivers, lanes, preferences, factoring and documents.</CardBody>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Document requirements</CardTitle>
        </CardHeader>
        <ul className="divide-y divide-steel-100">
          {(reqs ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <p className="font-semibold">
                  {r.label} <span className="font-normal text-steel-600">({DOCUMENT_TYPE_LABELS[r.doc_type]})</span>
                </p>
                <p className="text-xs text-steel-600">
                  {[r.required_for_application && "required to apply", r.required_for_activation && "required to activate", r.tracks_expiration && `expiration tracked (${r.reminder_days.join(", ")} days)`, !r.active && "inactive"]
                    .filter(Boolean)
                    .join(" · ") || "optional"}
                </p>
              </div>
              <FormDialog title={`Edit ${r.label}`} triggerLabel="Edit" triggerVariant="secondary" triggerSize="sm">
                <ActionForm action={saveDocumentRequirement} submitLabel="Save">
                  <input type="hidden" name="id" value={r.id} />
                  <FormField id={`dr-${r.id}-label`} name="label" label="Label" required>
                    <Input name="label" defaultValue={r.label} maxLength={120} />
                  </FormField>
                  <FormField id={`dr-${r.id}-desc`} name="description" label="Help text">
                    <Textarea name="description" rows={2} defaultValue={r.description ?? ""} maxLength={500} />
                  </FormField>
                  <FormField id={`dr-${r.id}-days`} name="reminder_days" label="Reminder days before expiration">
                    <Input name="reminder_days" defaultValue={r.reminder_days.join(", ")} />
                  </FormField>
                  <div className="space-y-1 text-sm">
                    {(
                      [
                        ["required_for_application", "Required to submit an application"],
                        ["required_for_activation", "Required before activation"],
                        ["tracks_expiration", "Track expiration date"],
                        ["active", "Active"],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="flex items-center gap-2">
                        <Checkbox name={k} defaultChecked={r[k]} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </ActionForm>
              </FormDialog>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
