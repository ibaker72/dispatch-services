import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateSupportRequest } from "../actions";
import { ActionForm, FormField } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList } from "@/components/ui/detail-list";
import { Checkbox, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";
import { isUuid } from "@/lib/db/query";
import { formatDate, formatDateTime } from "@/lib/domain/dates";
import { SUPPORT_CATEGORIES } from "@/lib/domain/labels";
import { getOperationsSettings } from "@/lib/settings";
import { listStaff, staffLabel } from "@/lib/staff";

export const metadata = { title: "Support request" };

export default async function SupportRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireStaff();
  const { timezone } = await getOperationsSettings();
  const { data: r } = await ctx.supabase
    .from("support_requests")
    .select("*, carriers(legal_name, cancellation_effective_date), loads(id, reference), requester:profiles!support_requests_created_by_fkey(full_name, email)")
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();
  const staff = await listStaff(ctx.supabase);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/dashboard/support" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Support requests
          </Link>
        }
        title={r.subject}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} />
            {SUPPORT_CATEGORIES[r.category as keyof typeof SUPPORT_CATEGORIES] ?? r.category}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="whitespace-pre-line text-sm">{r.body}</p>
            <DetailList
              items={[
                [
                  "Carrier",
                  <Link key="c" href={`/dashboard/carriers/${r.carrier_id}`} className="underline">
                    {r.carriers?.legal_name}
                  </Link>,
                ],
                ["From", r.requester ? `${r.requester.full_name ?? ""} ${r.requester.email}`.trim() : null],
                ["Received", formatDateTime(r.created_at, timezone)],
                [
                  "Load",
                  r.loads ? (
                    <Link key="l" href={`/dashboard/loads/${r.loads.id}`} className="underline">
                      {r.loads.reference}
                    </Link>
                  ) : null,
                ],
                ...(r.category === "cancellation" && r.carriers?.cancellation_effective_date
                  ? ([["Service ends", formatDate(r.carriers.cancellation_effective_date)]] as Array<[string, string]>)
                  : []),
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Update</CardTitle>
          </CardHeader>
          <CardBody>
            <ActionForm action={updateSupportRequest} submitLabel="Save update" successMessage="Request updated.">
              <input type="hidden" name="id" value={r.id} />
              <FormField id="s-status" name="status" label="Status">
                <Select name="status" defaultValue={r.status}>
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="waiting_on_carrier">Waiting on carrier</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </Select>
              </FormField>
              <FormField id="s-assignee" name="assigned_to" label="Assigned to">
                <Select name="assigned_to" defaultValue={r.assigned_to ?? ""}>
                  <option value="">Unassigned</option>
                  {staff.map((s) => (
                    <option key={s.user_id} value={s.user_id}>
                      {staffLabel(s)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField id="s-note" name="resolution_note" label="Response / resolution" hint="Visible to the carrier in the portal.">
                <Textarea name="resolution_note" rows={4} maxLength={4000} defaultValue={r.resolution_note ?? ""} />
              </FormField>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="notify" defaultChecked />
                <span>Email this response to the requester</span>
              </label>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
