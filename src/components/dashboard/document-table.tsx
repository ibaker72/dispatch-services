import { Download } from "lucide-react";
import type * as React from "react";
import { StatusBadge } from "@/components/status-badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/domain/dates";
import { DOCUMENT_TYPE_LABELS, formatBytes } from "@/lib/domain/labels";

export interface DocumentRow {
  id: string;
  doc_type: keyof typeof DOCUMENT_TYPE_LABELS;
  status: string;
  original_filename: string;
  size_bytes: number;
  expires_on: string | null;
  uploaded_at: string;
  review_note?: string | null;
}

/** Documents with RLS-checked download links (/api/documents/:id/download). */
export function DocumentTable({ documents, actions, caption = "Documents" }: { documents: DocumentRow[]; actions?: (doc: DocumentRow) => React.ReactNode; caption?: string }) {
  return (
    <Table caption={caption}>
      <THead>
        <tr>
          <TH>Document</TH>
          <TH>Status</TH>
          <TH>Expires</TH>
          <TH>Uploaded</TH>
          <TH>
            <span className="sr-only">Actions</span>
          </TH>
        </tr>
      </THead>
      <tbody>
        {documents.map((d) => (
          <TR key={d.id}>
            <TD>
              <div className="font-medium">{DOCUMENT_TYPE_LABELS[d.doc_type]}</div>
              <div className="max-w-[16rem] truncate text-xs text-steel-600" title={d.original_filename}>
                {d.original_filename} · {formatBytes(d.size_bytes)}
              </div>
              {d.review_note ? <div className="mt-1 text-xs text-steel-700">Note: {d.review_note}</div> : null}
            </TD>
            <TD>
              <StatusBadge status={d.status} />
            </TD>
            <TD>{d.expires_on ? formatDate(d.expires_on) : "—"}</TD>
            <TD>{formatDate(d.uploaded_at)}</TD>
            <TD className="text-right">
              <div className="flex flex-wrap justify-end gap-2">
                {d.status !== "uploading" ? (
                  <a
                    href={`/api/documents/${d.id}/download`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-steel-300 bg-white px-3 text-sm font-semibold text-navy-900 hover:bg-paper-2"
                  >
                    <Download className="size-4" aria-hidden="true" />
                    Download<span className="sr-only"> {DOCUMENT_TYPE_LABELS[d.doc_type]}</span>
                  </a>
                ) : null}
                {actions?.(d)}
              </div>
            </TD>
          </TR>
        ))}
      </tbody>
    </Table>
  );
}
