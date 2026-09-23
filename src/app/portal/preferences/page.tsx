import { saveOperatingPreferences } from "../actions";
import { ActionForm, FormDialog, FormField } from "@/components/action-form";
import { LaneForm } from "@/components/fleet/fleet-forms";
import { LaneList } from "@/components/fleet/fleet-tables";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { requireCarrierUser } from "@/lib/auth/session";
import { DAY_LABELS } from "@/lib/domain/labels";
import { US_STATES } from "@/lib/utils";
import { DAYS } from "@/lib/validation/application";

export const metadata = { title: "Lanes and rates" };

export default async function PreferencesPage() {
  const ctx = await requireCarrierUser();
  const owner = ctx.membership.role === "carrier_owner";
  const [{ data: c }, { data: lanes }] = await Promise.all([
    ctx.supabase.from("carriers").select("*").eq("id", ctx.membership.carrierId).single(),
    ctx.supabase.from("lane_preferences").select("*").eq("carrier_id", ctx.membership.carrierId).order("preference").order("destination_state"),
  ]);
  if (!c) return null;

  return (
    <>
      <PageHeader title="Lanes and rates" description="Your dispatcher uses these preferences to find loads. You still approve every load individually." />
      {!owner ? <Alert tone="info" className="mb-6">Only the company owner can change these preferences.</Alert> : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Operating preferences</CardTitle>
          </CardHeader>
          <CardBody>
            {owner ? (
              <ActionForm action={saveOperatingPreferences} submitLabel="Save preferences" successMessage="Preferences saved.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField id="min_rate_per_mile" name="min_rate_per_mile" label="Minimum rate per loaded mile ($)">
                    <Input name="min_rate_per_mile" inputMode="decimal" defaultValue={c.min_rate_per_mile ?? ""} />
                  </FormField>
                  <FormField id="desired_weekly_gross" name="desired_weekly_gross" label="Weekly gross goal ($)">
                    <Input name="desired_weekly_gross" inputMode="decimal" defaultValue={c.desired_weekly_gross ?? ""} />
                  </FormField>
                  <FormField id="max_deadhead_miles" name="max_deadhead_miles" label="Maximum deadhead (miles)">
                    <Input name="max_deadhead_miles" inputMode="numeric" defaultValue={c.max_deadhead_miles ?? ""} />
                  </FormField>
                  <FormField id="home_base_city" name="home_base_city" label="Home base city">
                    <Input name="home_base_city" defaultValue={c.home_base_city ?? ""} />
                  </FormField>
                  <FormField id="home_base_state" name="home_base_state" label="Home base state">
                    <Select name="home_base_state" defaultValue={c.home_base_state ?? ""}>
                      <option value="">—</option>
                      {US_STATES.map(([code, name]) => (
                        <option key={code} value={code}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField id="phone" name="phone" label="Dispatch phone">
                    <Input name="phone" type="tel" defaultValue={c.phone ?? ""} />
                  </FormField>
                  <FormField id="email" name="email" label="Company email">
                    <Input name="email" type="email" defaultValue={c.email ?? ""} />
                  </FormField>
                </div>
                <fieldset>
                  <legend className="text-sm font-semibold">Days available</legend>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {DAYS.map((d) => (
                      <label key={d} className="flex items-center gap-1.5 text-sm">
                        <Checkbox name="days_available[]" value={d} defaultChecked={c.days_available.includes(d)} />
                        {DAY_LABELS[d]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField id="factoring_status" name="factoring_status" label="How brokers pay you">
                    <Select name="factoring_status" defaultValue={c.factoring_status === "unknown" ? "none" : c.factoring_status}>
                      <option value="none">Brokers pay me directly</option>
                      <option value="factoring">Through my factoring company</option>
                      <option value="quick_pay">Broker quick pay</option>
                    </Select>
                  </FormField>
                  <FormField id="factoring_company_name" name="factoring_company_name" label="Factoring company">
                    <Input name="factoring_company_name" defaultValue={c.factoring_company_name ?? ""} />
                  </FormField>
                </div>
                <FormField id="preferences_notes" name="preferences_notes" label="Anything else your dispatcher should know">
                  <Textarea name="preferences_notes" rows={3} defaultValue={c.preferences_notes ?? ""} maxLength={2000} />
                </FormField>
              </ActionForm>
            ) : (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="font-semibold">Minimum rate</dt>
                  <dd>{c.min_rate_per_mile ? `$${Number(c.min_rate_per_mile).toFixed(2)} per loaded mile` : "Not set"}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Days available</dt>
                  <dd>{c.days_available.map((d) => DAY_LABELS[d] ?? d).join(", ") || "Not set"}</dd>
                </div>
              </dl>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lanes</CardTitle>
            {owner ? (
              <FormDialog title="Add lane preference" triggerLabel="Add lane" triggerVariant="secondary" triggerSize="sm">
                <LaneForm carrierId={c.id} />
              </FormDialog>
            ) : null}
          </CardHeader>
          <LaneList lanes={lanes ?? []} editable={owner} />
        </Card>
      </div>
    </>
  );
}
