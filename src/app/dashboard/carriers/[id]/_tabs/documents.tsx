import type { CarrierTabProps } from "./types";
import { DocumentReviewActions } from "@/components/dashboard/document-review";
import { DocumentTable, type DocumentRow } from "@/components/dashboard/document-table";
import { DocumentUploadForm } from "@/components/document-upload";
import { FormDialog } from "@/components/action-form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList } from "@/components/ui/detail-list";
import { formatDateTime } from "@/lib/domain/dates";
import { CARRIER_DOCUMENT_TYPES } from "@/lib/domain/labels";
import { getOperationsSettings } from "@/lib/settings";

export async function DocumentsTab({ ctx, carrier, admin }: CarrierTabProps) {
  const { timezone } = await getOperationsSettings();
  const [docs, acceptances] = await Promise.all([
    ctx.supabase
      .from("documents")
      .select("id, doc_type, status, original_filename, size_bytes, expires_on, uploaded_at, review_note, load_id, visibility, loads(reference)")
      .eq("carrier_id", carrier.id)
      .is("deleted_at", null)
      .neq("status", "uploading")
      .order("uploaded_at", { ascending: false }),
    ctx.supabase
      .from("agreement_acceptances")
      .select("id, signer_name, signer_title, accepted_at, ip_address, document_hash, revoked_at, revocation_reason, terminated_at, agreement_versions(version, title)")
      .eq("carrier_id", carrier.id)
      .order("accepted_at", { ascending: false }),
  ]);
  const all = docs.data ?? [];
  const company = all.filter((d) => !d.load_id);
  const loadDocs = all.filter((d) => d.load_id);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Company documents</CardTitle>
          <FormDialog title="Upload document" triggerLabel="Upload" triggerVariant="secondary" triggerSize="sm">
            <DocumentUploadForm carrierId={carrier.id} types={CARRIER_DOCUMENT_TYPES} allowInternal />
          </FormDialog>
        </CardHeader>
        {company.length ? (
          <DocumentTable
            documents={company as DocumentRow[]}
            caption="Company documents"
            actions={(d) => <DocumentReviewActions doc={d} canArchive={admin} />}
          />
        ) : (
          <CardBody className="text-sm text-steel-600">No company documents yet.</CardBody>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Load documents</CardTitle>
        </CardHeader>
        {loadDocs.length ? (
          <DocumentTable documents={loadDocs as DocumentRow[]} caption="Load documents" actions={(d) => <DocumentReviewActions doc={d} canArchive={admin} />} />
        ) : (
          <CardBody className="text-sm text-steel-600">Rate confirmations, BOLs and PODs uploaded on loads appear here.</CardBody>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agreement acceptances</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {(acceptances.data ?? []).length ? (
            acceptances.data!.map((a) => (
              <div key={a.id} className="rounded-md border border-steel-200 p-3">
                <p className="font-semibold">
                  {a.agreement_versions?.title} <span className="font-normal text-steel-600">v{a.agreement_versions?.version}</span>
                  {a.revoked_at ? <span className="ml-2 text-sm text-danger">Revoked</span> : a.terminated_at ? <span className="ml-2 text-sm text-warning">Terminated</span> : null}
                </p>
                <DetailList
                  className="mt-2"
                  items={[
                    ["Signed by", `${a.signer_name}${a.signer_title ? `, ${a.signer_title}` : ""}`],
                    ["Accepted", formatDateTime(a.accepted_at, timezone)],
                    ["IP address", a.ip_address ? String(a.ip_address) : null],
                    ["Document SHA-256", <span key="h" className="font-mono text-xs break-all">{a.document_hash}</span>],
                    ...(a.revoked_at ? ([["Revocation reason", a.revocation_reason]] as Array<[string, string | null]>) : []),
                  ]}
                />
              </div>
            ))
          ) : (
            <p className="text-sm text-steel-600">No agreements accepted yet. The carrier owner accepts agreements in the portal during onboarding.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
