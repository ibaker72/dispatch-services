import Link from "next/link";
import { acceptAgreement } from "../actions";
import { ActionForm, FormCheckbox, FormField } from "@/components/action-form";
import { DocumentTable, type DocumentRow } from "@/components/dashboard/document-table";
import { DocumentUploadForm } from "@/components/document-upload";
import { OnboardingChecklist, parseOnboarding } from "@/components/onboarding-checklist";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { requireCarrierUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/domain/dates";
import { CARRIER_DOCUMENT_TYPES } from "@/lib/domain/labels";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const ctx = await requireCarrierUser();
  const carrierId = ctx.membership.carrierId;
  const owner = ctx.membership.role === "carrier_owner";
  const { timezone } = await getOperationsSettings();

  const [onboarding, agreements, acceptances, docs, requirements] = await Promise.all([
    ctx.supabase.rpc("get_carrier_onboarding", { p_carrier_id: carrierId }),
    ctx.supabase
      .from("agreements")
      .select("id, key, title, description, required_for_activation, agreement_versions(id, version, title, body_markdown, body_sha256, status, legal_review_status)")
      .eq("active", true)
      .eq("audience", "carrier")
      .order("sort_order"),
    ctx.supabase.from("agreement_acceptances").select("agreement_version_id, accepted_at, signer_name, revoked_at").eq("carrier_id", carrierId),
    ctx.supabase
      .from("documents")
      .select("id, doc_type, status, original_filename, size_bytes, expires_on, uploaded_at, review_note")
      .eq("carrier_id", carrierId)
      .is("load_id", null)
      .is("deleted_at", null)
      .neq("status", "uploading")
      .order("uploaded_at", { ascending: false }),
    ctx.supabase.from("document_requirements").select("doc_type, label, description, required_for_activation, tracks_expiration").eq("active", true).eq("applies_to", "carrier").eq("required_for_activation", true).order("sort_order"),
  ]);
  const { steps, complete } = parseOnboarding(onboarding.data);
  const accepted = new Map((acceptances.data ?? []).filter((a) => !a.revoked_at).map((a) => [a.agreement_version_id, a]));

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="Complete these steps so we can start dispatching for you. Each step is checked by our team; your account is activated only when everything is in place."
      />
      {complete && ctx.membership.carrierStatus !== "active" ? (
        <Alert tone="success" title="All steps complete" className="mb-6">
          Our team will review and activate your account shortly.
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <section aria-labelledby="agreements-heading" className="space-y-4">
            <h2 id="agreements-heading" className="text-lg font-semibold">
              Agreements
            </h2>
            {!owner ? <Alert tone="info">Only the company owner can accept agreements.</Alert> : null}
            {(agreements.data ?? [])
              .filter((a) => a.required_for_activation)
              .map((a) => {
                const version = a.agreement_versions.find((v) => v.status === "published");
                const acceptance = version ? accepted.get(version.id) : undefined;
                return (
                  <Card key={a.id}>
                    <CardHeader>
                      <div>
                        <CardTitle>{a.title}</CardTitle>
                        {a.description ? <p className="text-sm text-steel-600">{a.description}</p> : null}
                      </div>
                      {version ? <span className="text-xs text-steel-600">Version {version.version}</span> : null}
                    </CardHeader>
                    <CardBody className="space-y-4">
                      {!version ? (
                        <p className="text-sm text-steel-600">This agreement is being prepared. We will let you know when it is ready to review.</p>
                      ) : acceptance ? (
                        <Alert tone="success" title="Accepted">
                          Accepted by {acceptance.signer_name} on {formatDateTime(acceptance.accepted_at, timezone)}.
                        </Alert>
                      ) : (
                        <>
                          <div className="prose-legal max-h-96 overflow-y-auto rounded-md border border-steel-200 bg-paper p-4 text-sm whitespace-pre-line" tabIndex={0} aria-label={`${version.title} text`}>
                            {version.body_markdown}
                          </div>
                          <p className="font-mono text-xs break-all text-steel-500">Document fingerprint (SHA-256): {version.body_sha256}</p>
                          {owner ? (
                            <ActionForm action={acceptAgreement} submitLabel="Accept agreement" pendingLabel="Recording acceptance…">
                              <input type="hidden" name="version_id" value={version.id} />
                              <div className="grid gap-4 sm:grid-cols-2">
                                <FormField id={`${a.key}-name`} name="signer_name" label="Full legal name" required>
                                  <Input name="signer_name" defaultValue={ctx.profile?.full_name ?? ""} autoComplete="name" />
                                </FormField>
                                <FormField id={`${a.key}-title`} name="signer_title" label="Title" required>
                                  <Input name="signer_title" defaultValue="Owner" autoComplete="organization-title" />
                                </FormField>
                              </div>
                              <FormCheckbox id={`${a.key}-agree`} name="agree">
                                I have read this agreement, I am authorized to sign for {ctx.membership.carrierName}, and I agree to its terms. We record the time, your IP address and browser, and a fingerprint of the exact text.
                              </FormCheckbox>
                            </ActionForm>
                          ) : null}
                        </>
                      )}
                    </CardBody>
                  </Card>
                );
              })}
          </section>

          <section aria-labelledby="documents-heading" className="space-y-4">
            <h2 id="documents-heading" className="text-lg font-semibold">
              Documents
            </h2>
            <Card>
              <CardHeader>
                <CardTitle>Required documents</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {(requirements.data ?? []).map((r) => (
                    <li key={r.doc_type}>
                      <span className="font-medium">{r.label}</span>
                      {r.description ? <span className="text-steel-600"> — {r.description}</span> : null}
                    </li>
                  ))}
                </ul>
                <DocumentUploadForm carrierId={carrierId} types={CARRIER_DOCUMENT_TYPES} defaultType="certificate_of_insurance" idPrefix="onboarding-doc" />
              </CardBody>
              {(docs.data ?? []).length ? <DocumentTable documents={docs.data as DocumentRow[]} caption="Your documents" /> : null}
            </Card>
          </section>
        </div>
        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Checklist</CardTitle>
            </CardHeader>
            <CardBody>
              <OnboardingChecklist
                steps={steps}
                hint={(s) =>
                  s.key === "factoring" ? (
                    <Link href="/portal/preferences" className="underline">
                      Add payment details
                    </Link>
                  ) : s.key === "fleet_setup" ? (
                    <Link href="/portal/fleet" className="underline">
                      Review trucks and drivers
                    </Link>
                  ) : s.key.startsWith("document:") || s.key === "insurance_current" ? (
                    "Upload it on this page; our team reviews each document."
                  ) : s.key === "authority_verified" || s.key === "dispatcher_assigned" || s.key === "fee_contract" ? (
                    "Our team completes this step."
                  ) : null
                }
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>How dispatch works</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2 text-sm text-steel-700">
              <p>We work for you under your own operating authority. We are not a broker and never take payment from brokers or shippers.</p>
              <p>We propose loads; you approve or reject each one. Brokers pay you (or your factoring company) directly, and we invoice only our dispatch fee.</p>
              <Link href="/dispatch-disclosure" className="font-semibold underline">
                Read the dispatch relationship disclosure
              </Link>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
