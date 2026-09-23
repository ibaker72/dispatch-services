import Link from "next/link";
import { requestCancellation, saveNotificationPreferences, updateMyProfile } from "../actions";
import { ActionForm, ConfirmAction, FormCheckbox, FormField } from "@/components/action-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { requireCarrierUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/domain/dates";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Account" };

const CATEGORIES = [
  ["load_updates", "Load proposals and status updates"],
  ["documents", "Document and insurance reminders"],
  ["billing", "Statements, invoices and receipts"],
] as const;

export default async function AccountPage() {
  const ctx = await requireCarrierUser();
  const owner = ctx.membership.role === "carrier_owner";
  const [{ data: prefs }, { data: carrier }, { data: me }, ops] = await Promise.all([
    ctx.supabase.from("notification_preferences").select("category, email_enabled").eq("user_id", ctx.userId),
    ctx.supabase.from("carriers").select("cancellation_requested_at, cancellation_effective_date, status").eq("id", ctx.membership.carrierId).single(),
    ctx.supabase.from("profiles").select("full_name, phone, title").eq("id", ctx.userId).single(),
    getOperationsSettings(),
  ]);
  const enabled = (c: string) => prefs?.find((p) => p.category === c)?.email_enabled ?? true;

  return (
    <>
      <PageHeader title="Account" description={`Signed in as ${ctx.email}.`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your profile</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <ActionForm action={updateMyProfile} submitLabel="Save profile" successMessage="Saved.">
              <FormField id="full_name" name="full_name" label="Full name" required>
                <Input name="full_name" defaultValue={me?.full_name ?? ""} autoComplete="name" />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="phone" name="phone" label="Phone">
                  <Input name="phone" type="tel" defaultValue={me?.phone ?? ""} autoComplete="tel" />
                </FormField>
                <FormField id="title" name="title" label="Title">
                  <Input name="title" defaultValue={me?.title ?? ""} />
                </FormField>
              </div>
            </ActionForm>
            <p className="text-sm">
              <Link href="/forgot-password" className="font-semibold underline">
                Change your password
              </Link>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Email notifications</CardTitle>
          </CardHeader>
          <CardBody>
            <ActionForm action={saveNotificationPreferences} submitLabel="Save preferences" successMessage="Saved.">
              <div className="space-y-2">
                {CATEGORIES.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <Checkbox name={key} defaultChecked={enabled(key)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-steel-600">Security emails (sign-in links, password resets, invitations) and agreement receipts are always sent.</p>
            </ActionForm>
          </CardBody>
        </Card>
        {owner ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>End dispatch service</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4 text-sm">
              {carrier?.cancellation_requested_at ? (
                <Alert tone="warning" title="Cancellation requested">
                  Service ends on {formatDate(carrier.cancellation_effective_date)}. Loads already booked will be completed, and a final statement will follow.
                </Alert>
              ) : (
                <>
                  <p className="text-steel-700">
                    You can end the dispatch service at any time under your agreement. Service ends after the {ops.cancellation_notice_days}-day notice period. Loads already booked are completed; you receive a final statement.
                  </p>
                  <ConfirmAction action={requestCancellation} title="Request cancellation" description={`Service will end ${ops.cancellation_notice_days} days from today.`} triggerLabel="Request cancellation" confirmLabel="Request cancellation">
                    <FormField id="reason" name="reason" label="Reason" required>
                      <Textarea name="reason" rows={3} maxLength={2000} />
                    </FormField>
                    <FormCheckbox id="confirm-cancel" name="confirm">
                      I want to end dispatch service for {ctx.membership.carrierName}.
                    </FormCheckbox>
                  </ConfirmAction>
                </>
              )}
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
