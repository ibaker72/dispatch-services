import { createAgreementVersion, publishAgreementVersion, recordAttorneyApproval, updateAgreementDraft } from "../actions";
import { ActionForm, FormDialog, FormField } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Textarea } from "@/components/ui/input";
import { formatDate } from "@/lib/domain/dates";
import type { UserSupabaseClient } from "@/lib/supabase/server";

export async function AgreementsSection({ supabase, elevated, superAdmin }: { supabase: UserSupabaseClient; elevated: boolean; superAdmin: boolean }) {
  const { data: agreements } = await supabase
    .from("agreements")
    .select("id, key, title, description, required_for_activation, requires_attorney_approval_to_publish, active, agreement_versions(id, version, title, status, legal_review_status, attorney_approved_by_name, attorney_approved_at, published_at, body_sha256, body_markdown, created_at)")
    .order("sort_order");

  return (
    <div className="space-y-6">
      <Alert tone="warning" title="Attorney review required">
        The bundled agreement texts are drafts written to explain the dispatch relationship. Have a licensed attorney review every agreement before using it with carriers. Published text is immutable and every acceptance records the exact version, time, signer, IP address, browser and a SHA-256 fingerprint.
      </Alert>
      {(agreements ?? []).map((a) => {
        const versions = [...a.agreement_versions].sort((x, y) => y.created_at.localeCompare(x.created_at));
        return (
          <Card key={a.id}>
            <CardHeader>
              <div>
                <CardTitle>{a.title}</CardTitle>
                <p className="text-sm text-steel-600">
                  {a.required_for_activation ? "Required before activation" : "Optional"}
                  {a.requires_attorney_approval_to_publish ? " · publishing requires recorded attorney approval" : ""}
                  {!a.active ? " · inactive" : ""}
                </p>
              </div>
              <FormDialog title={`New version of ${a.title}`} description="Use {{legal_entity}} and {{cancellation_notice_days}} placeholders; they are filled in from settings when you publish." triggerLabel="New version" triggerVariant="secondary" triggerSize="sm">
                <ActionForm action={createAgreementVersion} submitLabel="Save draft">
                  <input type="hidden" name="agreement_id" value={a.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField id={`${a.key}-version`} name="version" label="Version" required>
                      <Input name="version" maxLength={20} placeholder="1.0" />
                    </FormField>
                    <FormField id={`${a.key}-title`} name="title" label="Title" required>
                      <Input name="title" defaultValue={a.title} maxLength={200} />
                    </FormField>
                  </div>
                  <FormField id={`${a.key}-body`} name="body_markdown" label="Agreement text (Markdown)" required>
                    <Textarea name="body_markdown" rows={14} defaultValue={versions[0]?.body_markdown ?? ""} className="font-mono text-sm" />
                  </FormField>
                </ActionForm>
              </FormDialog>
            </CardHeader>
            <ul className="divide-y divide-steel-100">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-col gap-3 px-5 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      v{v.version} · {v.title} <StatusBadge status={v.status} />{" "}
                      {v.legal_review_status === "attorney_approved" ? <Badge tone="success">Attorney approved</Badge> : <Badge tone="warning">Needs attorney review</Badge>}
                    </p>
                    <p className="text-xs text-steel-600">
                      Created {formatDate(v.created_at)}
                      {v.published_at ? ` · published ${formatDate(v.published_at)}` : ""}
                      {v.attorney_approved_by_name ? ` · approved by ${v.attorney_approved_by_name} on ${formatDate(v.attorney_approved_at)}` : ""}
                    </p>
                    <p className="font-mono text-xs break-all text-steel-500">SHA-256 {v.body_sha256}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <FormDialog title={`${v.title} v${v.version}`} triggerLabel={v.status === "draft" ? "Edit" : "View"} triggerVariant="ghost" triggerSize="sm">
                      {v.status === "draft" ? (
                        <ActionForm action={updateAgreementDraft} submitLabel="Save draft">
                          <input type="hidden" name="id" value={v.id} />
                          <FormField id={`${v.id}-title`} name="title" label="Title" required>
                            <Input name="title" defaultValue={v.title} maxLength={200} />
                          </FormField>
                          <FormField id={`${v.id}-body`} name="body_markdown" label="Agreement text" required>
                            <Textarea name="body_markdown" rows={16} defaultValue={v.body_markdown} className="font-mono text-sm" />
                          </FormField>
                        </ActionForm>
                      ) : (
                        <pre className="max-h-[60vh] overflow-auto rounded-md bg-paper-2 p-3 text-xs whitespace-pre-wrap">{v.body_markdown}</pre>
                      )}
                    </FormDialog>
                    {v.status === "draft" ? (
                      <FormDialog title="Publish version" description="Publishing retires the current version. Carriers will be asked to accept the new text." triggerLabel="Publish" triggerSize="sm">
                        <ActionForm action={publishAgreementVersion} submitLabel="Publish">
                          <input type="hidden" name="id" value={v.id} />
                          <label className="flex items-start gap-2 text-sm">
                            <Checkbox name="confirm" />
                            <span>I confirm this text has been reviewed and approved for use{a.requires_attorney_approval_to_publish ? " (attorney approval must also be recorded)" : ""}.</span>
                          </label>
                        </ActionForm>
                      </FormDialog>
                    ) : null}
                    {superAdmin && v.legal_review_status !== "attorney_approved" && v.status !== "retired" ? (
                      <FormDialog title="Record attorney approval" description={elevated ? "Record the attorney who approved this exact version." : "Requires two-step verification in this session."} triggerLabel="Record attorney approval" triggerVariant="secondary" triggerSize="sm">
                        <ActionForm action={recordAttorneyApproval} submitLabel="Record approval">
                          <input type="hidden" name="id" value={v.id} />
                          <FormField id={`${v.id}-atty`} name="attorney_approved_by_name" label="Attorney name and firm" required>
                            <Input name="attorney_approved_by_name" maxLength={200} />
                          </FormField>
                          <FormField id={`${v.id}-atty-date`} name="approved_on" label="Approval date">
                            <Input name="approved_on" type="date" />
                          </FormField>
                        </ActionForm>
                      </FormDialog>
                    ) : null}
                  </div>
                </li>
              ))}
              {versions.length === 0 ? <CardBody className="text-sm text-steel-600">No versions yet.</CardBody> : null}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
