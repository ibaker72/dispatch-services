"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { finalizeDocumentUploadAction, requestDocumentUploadAction } from "@/app/actions/documents";
import type { Enums } from "@/lib/db/database.types";
import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/labels";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/security/files";

const ACCEPT = [...Object.keys(ALLOWED_UPLOAD_TYPES), ".pdf", ".png", ".jpg", ".jpeg", ".webp"].join(",");
type DocType = Enums<"document_type">;

/**
 * Upload form: the file goes directly to private storage with a signed URL,
 * then the server verifies type and size before the document is recorded.
 */
export function DocumentUploadForm({
  carrierId,
  loadId,
  driverId,
  truckId,
  types,
  defaultType,
  expiringTypes = ["certificate_of_insurance", "driver_license", "medical_card", "truck_registration", "trailer_registration"],
  allowInternal = false,
  onUploaded,
  idPrefix = "upload",
}: {
  carrierId: string;
  loadId?: string;
  driverId?: string;
  truckId?: string;
  types: readonly DocType[];
  defaultType?: DocType;
  expiringTypes?: DocType[];
  allowInternal?: boolean;
  onUploaded?: () => void;
  idPrefix?: string;
}) {
  const router = useRouter();
  const [docType, setDocType] = React.useState<DocType>(defaultType ?? types[0]!);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = fileRef.current?.files?.[0];
    setMessage(null);
    if (!file) return setMessage({ tone: "danger", text: "Choose a file to upload." });
    if (file.size > MAX_UPLOAD_BYTES) return setMessage({ tone: "danger", text: "Files must be 10 MB or smaller." });
    setBusy(true);
    try {
      const requested = await requestDocumentUploadAction({
        carrierId,
        loadId,
        driverId,
        truckId,
        docType,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        expiresOn: String(data.get("expires_on") ?? ""),
        internal: data.get("internal") === "on",
      });
      if (!requested.ok) throw new Error(requested.fieldErrors?.expiresOn?.[0] ?? requested.error);
      const { documentId, upload } = requested.data;
      const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
      if (!put.ok) throw new Error("The upload failed. Please try again.");
      const finalized = await finalizeDocumentUploadAction({ documentId });
      if (!finalized.ok) throw new Error(finalized.error);
      form.reset();
      setMessage({ tone: "success", text: `${DOCUMENT_TYPE_LABELS[docType]} uploaded.` });
      onUploaded?.();
      router.refresh();
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "The upload failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${idPrefix}-type`} label="Document type" required>
          <Select value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        {expiringTypes.includes(docType) ? (
          <Field id={`${idPrefix}-expires`} label="Expiration date" hint="Used for renewal reminders.">
            <Input type="date" name="expires_on" />
          </Field>
        ) : null}
      </div>
      <Field id={`${idPrefix}-file`} label="File" hint="PDF, PNG, JPG or WebP, up to 10 MB." required>
        <Input ref={fileRef} type="file" name="file" accept={ACCEPT} className="py-1.5" />
      </Field>
      {allowInternal ? (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox name="internal" />
          <span>Internal only (hidden from the carrier)</span>
        </label>
      ) : null}
      {message ? (
        <Alert tone={message.tone} live>
          {message.text}
        </Alert>
      ) : null}
      <Button type="submit" disabled={busy}>
        <Upload aria-hidden="true" />
        {busy ? "Uploading…" : "Upload"}
      </Button>
    </form>
  );
}
