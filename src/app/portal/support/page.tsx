import { createSupportRequest } from "../actions";
import { ActionForm, FormDialog, FormField } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { requireCarrierUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/domain/dates";
import { SUPPORT_CATEGORIES } from "@/lib/domain/labels";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Support" };

export default async function PortalSupportPage() {
  const ctx = await requireCarrierUser();
  const { timezone } = await getOperationsSettings();
  const [requests, loads] = await Promise.all([
    ctx.supabase.from("support_requests").select("id, subject, category, status, body, resolution_note, created_at, loads(reference)").order("created_at", { ascending: false }).limit(50),
    ctx.supabase.from("loads").select("id, reference").neq("status", "cancelled").order("created_at", { ascending: false }).limit(50),
  ]);
  return (
    <>
      <PageHeader
        title="Support"
        description="Questions about a load, documents, billing or the portal. Your dispatcher and our office team see these requests."
        actions={
          <FormDialog title="New support request" triggerLabel="New request">
            <ActionForm action={createSupportRequest} submitLabel="Send request" successMessage="Request sent. We will reply by email." resetOnSuccess>
              <FormField id="s-category" name="category" label="Topic" required>
                <Select name="category" defaultValue="general">
                  {Object.entries(SUPPORT_CATEGORIES)
                    .filter(([k]) => k !== "cancellation")
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                </Select>
              </FormField>
              <FormField id="s-load" name="load_id" label="Related load (optional)">
                <Select name="load_id" defaultValue="">
                  <option value="">None</option>
                  {(loads.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.reference}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField id="s-subject" name="subject" label="Subject" required>
                <Input name="subject" maxLength={200} />
              </FormField>
              <FormField id="s-body" name="body" label="Details" required>
                <Textarea name="body" rows={5} maxLength={5000} />
              </FormField>
            </ActionForm>
          </FormDialog>
        }
      />
      {(requests.data ?? []).length ? (
        <div className="space-y-4">
          {requests.data!.map((r) => (
            <Card key={r.id}>
              <CardHeader>
                <div>
                  <CardTitle>{r.subject}</CardTitle>
                  <p className="text-xs text-steel-600">
                    {SUPPORT_CATEGORIES[r.category as keyof typeof SUPPORT_CATEGORIES] ?? r.category}
                    {r.loads ? ` · Load ${r.loads.reference}` : ""} · {formatDateTime(r.created_at, timezone)}
                  </p>
                </div>
                <StatusBadge status={r.status} />
              </CardHeader>
              <CardBody className="space-y-3 text-sm">
                <p className="whitespace-pre-line">{r.body}</p>
                {r.resolution_note ? (
                  <div className="rounded-md bg-paper-2 p-3">
                    <p className="text-xs font-semibold text-steel-600 uppercase">Response</p>
                    <p className="whitespace-pre-line">{r.resolution_note}</p>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardBody className="text-sm text-steel-600">No support requests yet.</CardBody>
        </Card>
      )}
    </>
  );
}
