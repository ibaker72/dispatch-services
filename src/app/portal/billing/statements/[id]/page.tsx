import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatementView } from "@/components/billing/statement-view";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { requireCarrierUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/db/query";
import { formatDate } from "@/lib/domain/dates";

export const metadata = { title: "Statement" };

export default async function PortalStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCarrierUser();
  const { data: s } = await ctx.supabase.from("weekly_statements").select("*").eq("id", id).maybeSingle();
  if (!s) notFound();
  const { data: lines } = await ctx.supabase.from("statement_line_items").select("*").eq("statement_id", id).eq("voided", false).order("created_at");
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/portal/billing" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Statements and invoices
          </Link>
        }
        title={`Week of ${formatDate(s.period_start)}`}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={s.status} /> {formatDate(s.period_start)} – {formatDate(s.period_end)}
          </span>
        }
        actions={
          s.invoice_id ? (
            <Link href={`/portal/billing/invoices/${s.invoice_id}`} className="inline-flex h-10 items-center rounded-md bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">
              View invoice
            </Link>
          ) : null
        }
      />
      <StatementView statement={s} lines={lines ?? []} />
    </>
  );
}
