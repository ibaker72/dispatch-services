import { saveBusinessProfile, saveEmailTemplateOverride, saveNotificationSchedules, saveOperationsSettings } from "../actions";
import { ActionForm, FormField } from "@/components/action-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { isPlaceholder } from "@/config/business";
import { TEMPLATE_LABELS, type TemplateKey } from "@/lib/email/templates";
import { getBusinessProfile, getEmailTemplateOverrides, getNotificationSchedules, getOperationsSettings } from "@/lib/settings";

export async function BusinessSection() {
  const p = await getBusinessProfile();
  const v = (s: string) => (isPlaceholder(s) ? "" : s);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Business profile</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-steel-600">Shown on the public site, emails, invoices and agreements. Use the exact registered legal entity name.</p>
        <ActionForm action={saveBusinessProfile} submitLabel="Save business profile" successMessage="Business profile saved.">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="brandName" name="brandName" label="Brand name" required>
              <Input name="brandName" defaultValue={v(p.brandName)} maxLength={80} />
            </FormField>
            <FormField id="legalEntity" name="legalEntity" label="Legal entity" required hint="For example: Example Dispatch LLC">
              <Input name="legalEntity" defaultValue={v(p.legalEntity)} maxLength={160} />
            </FormField>
            <FormField id="biz-email" name="email" label="Public email" required>
              <Input name="email" type="email" defaultValue={v(p.email)} />
            </FormField>
            <FormField id="biz-phone" name="phone" label="Public phone" required>
              <Input name="phone" type="tel" defaultValue={v(p.phone)} maxLength={40} />
            </FormField>
          </div>
          <FormField id="biz-address" name="address" label="Business address" required>
            <Input name="address" defaultValue={v(p.address)} maxLength={200} />
          </FormField>
        </ActionForm>
        <Alert tone="info">The site address comes from the NEXT_PUBLIC_SITE_URL environment variable. The company does not display USDOT or MC numbers unless it holds its own active authority.</Alert>
      </CardBody>
    </Card>
  );
}

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

export async function OperationsSection() {
  const [ops, schedules] = await Promise.all([getOperationsSettings(), getNotificationSchedules()]);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Operations</CardTitle>
        </CardHeader>
        <CardBody>
          <ActionForm action={saveOperationsSettings} submitLabel="Save operations settings" successMessage="Saved.">
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField id="timezone" name="timezone" label="Business timezone" hint="Statement weeks run Monday–Sunday in this zone.">
                <Select name="timezone" defaultValue={ops.timezone}>
                  {ZONES.map((z) => (
                    <option key={z} value={z}>
                      {z.replace("_", " ")}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField id="cancellation_notice_days" name="cancellation_notice_days" label="Cancellation notice (days)" hint="Must match the service agreement.">
                <Input name="cancellation_notice_days" type="number" min={0} max={90} defaultValue={ops.cancellation_notice_days} />
              </FormField>
              <FormField id="statement_due_days" name="statement_due_days" label="Invoice due (days)">
                <Input name="statement_due_days" type="number" min={0} max={60} defaultValue={ops.statement_due_days} />
              </FormField>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="auto_issue_statements" defaultChecked={ops.auto_issue_statements} />
              <span>Issue weekly statements automatically (otherwise the job creates drafts for review)</span>
            </label>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Notification schedules</CardTitle>
        </CardHeader>
        <CardBody>
          <ActionForm action={saveNotificationSchedules} submitLabel="Save schedules" successMessage="Saved.">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="document_reminder_days" name="document_reminder_days" label="Document expiration reminders (days before)">
                <Input name="document_reminder_days" defaultValue={schedules.document_reminder_days.join(", ")} />
              </FormField>
              <FormField id="invoice_reminder_days_before_due" name="invoice_reminder_days_before_due" label="Invoice reminder (days before due)">
                <Input name="invoice_reminder_days_before_due" type="number" defaultValue={schedules.invoice_reminder_days_before_due} />
              </FormField>
              <FormField id="invoice_overdue_reminder_interval_days" name="invoice_overdue_reminder_interval_days" label="Overdue reminder every (days)">
                <Input name="invoice_overdue_reminder_interval_days" type="number" defaultValue={schedules.invoice_overdue_reminder_interval_days} />
              </FormField>
              <FormField id="stale_application_days" name="stale_application_days" label="Flag unreviewed applications after (days)">
                <Input name="stale_application_days" type="number" defaultValue={schedules.stale_application_days} />
              </FormField>
              <FormField id="information_request_reminder_days" name="information_request_reminder_days" label="Remind applicants about info requests after (days)">
                <Input name="information_request_reminder_days" type="number" defaultValue={schedules.information_request_reminder_days} />
              </FormField>
              <FormField id="onboarding_reminder_days" name="onboarding_reminder_days" label="Onboarding reminders every (days)">
                <Input name="onboarding_reminder_days" type="number" defaultValue={schedules.onboarding_reminder_days} />
              </FormField>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="daily_summary_enabled" defaultChecked={schedules.daily_summary_enabled} />
              <span>Send the daily operations summary to administrators</span>
            </label>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

export async function EmailSection() {
  const overrides = await getEmailTemplateOverrides();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email templates</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-steel-600">Override the subject line or add an opening paragraph. Message bodies are fixed so compliance wording stays reviewed. Leave both blank to use the default.</p>
        <ul className="divide-y divide-steel-100">
          {(Object.keys(TEMPLATE_LABELS) as TemplateKey[]).map((key) => (
            <li key={key} className="py-3">
              <details>
                <summary className="cursor-pointer text-sm font-semibold">
                  {TEMPLATE_LABELS[key]}
                  {overrides[key] ? <span className="ml-2 text-xs font-normal text-accent-ink">customized</span> : null}
                </summary>
                <div className="mt-3">
                  <ActionForm action={saveEmailTemplateOverride} submitLabel="Save template" submitSize="sm" successMessage="Saved.">
                    <input type="hidden" name="template" value={key} />
                    <FormField id={`${key}-subject`} name="subject" label="Subject override">
                      <Input name="subject" defaultValue={overrides[key]?.subject ?? ""} maxLength={200} />
                    </FormField>
                    <FormField id={`${key}-intro`} name="intro" label="Opening paragraph">
                      <Textarea name="intro" rows={2} defaultValue={overrides[key]?.intro ?? ""} maxLength={1000} />
                    </FormField>
                  </ActionForm>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
