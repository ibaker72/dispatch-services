import { archiveDocument, reviewDocument } from "@/app/dashboard/carriers/actions";
import { ActionForm, ConfirmAction, FormDialog, FormField } from "@/components/action-form";
import type { DocumentRow } from "@/components/dashboard/document-table";
import { Input, Textarea } from "@/components/ui/input";
import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/labels";

/** Accept / reject / archive controls for staff document review. */
export function DocumentReviewActions({ doc, canArchive }: { doc: DocumentRow; canArchive: boolean }) {
  const label = DOCUMENT_TYPE_LABELS[doc.doc_type];
  return (
    <>
      {doc.status === "pending_review" || doc.status === "rejected" ? (
        <FormDialog title={`Review ${label}`} description={doc.original_filename} triggerLabel="Review" triggerVariant="secondary" triggerSize="sm">
          <div className="space-y-5">
            <ActionForm action={reviewDocument} submitLabel="Accept document">
              <input type="hidden" name="document_id" value={doc.id} />
              <input type="hidden" name="decision" value="accepted" />
              <FormField id={`exp-${doc.id}`} name="expires_on" label="Expiration date" hint={doc.doc_type === "certificate_of_insurance" ? "Required for insurance certificates." : "Leave blank if it does not expire."}>
                <Input name="expires_on" type="date" defaultValue={doc.expires_on ?? ""} />
              </FormField>
            </ActionForm>
            <hr className="border-steel-200" />
            <ActionForm action={reviewDocument} submitLabel="Reject document" submitVariant="danger">
              <input type="hidden" name="document_id" value={doc.id} />
              <input type="hidden" name="decision" value="rejected" />
              <FormField id={`note-${doc.id}`} name="review_note" label="Reason (shown to the carrier)" required>
                <Textarea name="review_note" rows={2} maxLength={2000} placeholder="The certificate lists an expired policy period." />
              </FormField>
            </ActionForm>
          </div>
        </FormDialog>
      ) : null}
      {canArchive && doc.status !== "accepted" ? (
        <ConfirmAction action={archiveDocument} title={`Archive ${label}?`} description="The file is hidden from lists but kept for the record." triggerLabel="Archive" triggerVariant="ghost" confirmLabel="Archive">
          <input type="hidden" name="document_id" value={doc.id} />
        </ConfirmAction>
      ) : null}
    </>
  );
}
