import { DocumentTable, type DocumentRow } from "@/components/dashboard/document-table";
import { DocumentUploadForm } from "@/components/document-upload";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireCarrierUser } from "@/lib/auth/session";
import { CARRIER_DOCUMENT_TYPES } from "@/lib/domain/labels";

export const metadata = { title: "Documents" };

export default async function PortalDocumentsPage() {
  const ctx = await requireCarrierUser();
  const { data } = await ctx.supabase
    .from("documents")
    .select("id, doc_type, status, original_filename, size_bytes, expires_on, uploaded_at, review_note, load_id, loads(reference)")
    .eq("carrier_id", ctx.membership.carrierId)
    .is("deleted_at", null)
    .neq("status", "uploading")
    .order("uploaded_at", { ascending: false });
  const docs = (data ?? []) as DocumentRow[];
  const company = docs.filter((d) => !(d as { load_id?: string | null }).load_id);
  const loadDocs = docs.filter((d) => (d as { load_id?: string | null }).load_id);

  return (
    <>
      <PageHeader title="Documents" description="Upload renewals before they expire. Files are stored privately and shared only with your dispatch team." />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Upload a company document</CardTitle>
          </CardHeader>
          <CardBody>
            <DocumentUploadForm carrierId={ctx.membership.carrierId} types={CARRIER_DOCUMENT_TYPES} defaultType="certificate_of_insurance" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Company documents</CardTitle>
          </CardHeader>
          {company.length ? <DocumentTable documents={company} caption="Company documents" /> : <CardBody className="text-sm text-steel-600">No documents yet.</CardBody>}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Load paperwork</CardTitle>
          </CardHeader>
          {loadDocs.length ? (
            <DocumentTable documents={loadDocs} caption="Load documents" />
          ) : (
            <CardBody className="text-sm text-steel-600">Rate confirmations, BOLs and PODs appear here. Upload them from each load.</CardBody>
          )}
        </Card>
      </div>
    </>
  );
}
