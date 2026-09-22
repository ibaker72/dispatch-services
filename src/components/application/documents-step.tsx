"use client";

import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useId, useState } from "react";
import { StepForm } from "./step-form";
import type { StepProps } from "./steps";
import { finalizeApplicationUpload, removeApplicationDocument, requestApplicationUpload } from "@/app/(marketing)/apply/actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/security/files";
import { documentsStrict } from "@/lib/validation/application";

export interface UploadedDocument {
  id: string;
  doc_type: string;
  original_filename: string;
  size_bytes: number;
  status: string;
}

export interface DocumentRequirement {
  doc_type: string;
  label: string;
  description: string | null;
  required_for_application: boolean;
}

const ACCEPT = [...Object.keys(ALLOWED_UPLOAD_TYPES), ".pdf", ".png", ".jpg", ".jpeg", ".webp"].join(",");

function formatSize(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** Uploads straight to private storage via a short-lived signed URL, then asks the server to verify the bytes. */
export async function uploadApplicationFile(file: File, docType: string): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Files must be 10 MB or smaller.");
  const requested = await requestApplicationUpload({ docType: docType as never, filename: file.name, mimeType: file.type, size: file.size });
  if (!requested.ok) throw new Error(requested.error);
  const { documentId, upload } = requested.data;
  const response = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  if (!response.ok) throw new Error("The upload failed. Please try again.");
  const finalized = await finalizeApplicationUpload({ documentId });
  if (!finalized.ok) throw new Error(finalized.error);
  return documentId;
}

function DocumentSlot({
  requirement,
  documents,
  onChange,
}: {
  requirement: DocumentRequirement;
  documents: UploadedDocument[];
  onChange: (docs: UploadedDocument[]) => void;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const mine = documents.filter((d) => d.doc_type === requirement.doc_type);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const id = await uploadApplicationFile(file, requirement.doc_type);
      onChange([...documents, { id, doc_type: requirement.doc_type, original_filename: file.name, size_bytes: file.size, status: "pending_review" }]);
      setMessage({ tone: "success", text: `${file.name} uploaded.` });
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Upload failed." });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string) {
    const result = await removeApplicationDocument({ documentId: id });
    if (result.ok) onChange(documents.filter((d) => d.id !== id));
    else setMessage({ tone: "danger", text: result.error });
  }

  return (
    <li className="rounded-lg border border-steel-200 bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-navy-900">
            {requirement.label} {requirement.required_for_application ? <Badge tone="accent">Required</Badge> : <Badge>Optional</Badge>}
          </p>
          {requirement.description ? <p className="mt-0.5 text-sm text-steel-600">{requirement.description}</p> : null}
        </div>
        <div>
          <input
            id={inputId}
            type="file"
            accept={ACCEPT}
            className="peer sr-only"
            disabled={busy}
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <label
            htmlFor={inputId}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-steel-300 bg-white px-4 text-sm font-semibold text-navy-900 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-navy-600 hover:bg-paper-2"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
            {busy ? "Uploading…" : mine.length ? "Upload another" : "Upload"}
            <span className="sr-only"> {requirement.label}</span>
          </label>
        </div>
      </div>
      {mine.length ? (
        <ul className="mt-3 space-y-2">
          {mine.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-steel-500" aria-hidden="true" />
                <span className="truncate">{doc.original_filename}</span>
                <span className="shrink-0 text-steel-600">{formatSize(doc.size_bytes)}</span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void onRemove(doc.id)} aria-label={`Remove ${doc.original_filename}`}>
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div aria-live="polite">
        {message ? <p className={`mt-2 text-sm ${message.tone === "danger" ? "font-medium text-danger" : "text-success"}`}>{message.text}</p> : null}
      </div>
    </li>
  );
}

export function DocumentsStep(
  props: StepProps & { documents: UploadedDocument[]; requirements: DocumentRequirement[]; onDocumentsChange: (docs: UploadedDocument[]) => void },
) {
  const missing = props.requirements.filter((r) => r.required_for_application && !props.documents.some((d) => d.doc_type === r.doc_type));
  return (
    <StepForm
      step="documents"
      title="Documents"
      description="PDF, PNG, JPEG or WebP, up to 10 MB each. Files are stored privately and shared only with our onboarding team."
      schema={documentsStrict}
      defaultValues={props.defaultValues as never}
      onProgress={props.onProgress as never}
      onBack={props.onBack}
    >
      {(form) => (
        <div className="space-y-6">
          <Field
            id="insuranceExpirationDate"
            label="Insurance expiration date"
            hint="From your current certificate of insurance."
            required
            error={form.formState.errors.insuranceExpirationDate?.message}
          >
            <Input type="date" {...form.register("insuranceExpirationDate")} />
          </Field>
          <ul className="space-y-3">
            {props.requirements.map((r) => (
              <DocumentSlot key={r.doc_type} requirement={r} documents={props.documents} onChange={props.onDocumentsChange} />
            ))}
          </ul>
          {missing.length ? (
            <Alert tone="info" title="Still needed before you submit">
              {missing.map((m) => m.label).join(", ")}. You can continue now and upload them before submitting.
            </Alert>
          ) : null}
        </div>
      )}
    </StepForm>
  );
}
