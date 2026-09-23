"use server";

import { z } from "zod";
import { type ActionResult, DbError, runFormAction } from "@/lib/actions";
import { requireStaff } from "@/lib/auth/session";
import { trackServer } from "@/lib/analytics/server";
import { notifyInvoiceDue, notifyPaymentReceived, notifyStatementIssued } from "@/lib/billing";
import { localDate, parseWeek } from "@/lib/domain/dates";
import { AppError } from "@/lib/errors";
import { getOperationsSettings } from "@/lib/settings";
import { formOptionalDate, formOptionalText, requiredText } from "@/lib/validation/common";

const amount = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, `${label} must be an amount like 150.00`)
    .refine((v) => Number(v) > 0, `${label} must be more than zero`);

/** Generates (or refreshes) draft statements for every carrier with activity or fees that week. */
export async function generateStatements(fd: FormData): Promise<ActionResult<{ count: number }>> {
  return runFormAction(z.object({ week: z.string() }), fd, async ({ week }) => {
    const ctx = await requireStaff({ admin: true });
    const { timezone } = await getOperationsSettings();
    const period = parseWeek(week, "");
    if (!period) throw new AppError("Choose a valid week.");
    if (period > localDate(new Date(), timezone)) throw new AppError("Statements can be generated only for weeks that have started.");
    const [{ data: carriers }, { data: snapshots }] = await Promise.all([
      ctx.supabase.from("carriers").select("id, status, activated_at").not("activated_at", "is", null),
      ctx.supabase.from("fee_snapshots").select("carrier_id").eq("statement_week", period),
    ]);
    const ids = new Set<string>([...(snapshots ?? []).map((s) => s.carrier_id), ...(carriers ?? []).filter((c) => c.status === "active").map((c) => c.id)]);
    let count = 0;
    for (const id of ids) {
      const { error } = await ctx.supabase.rpc("generate_weekly_statement", { p_carrier_id: id, p_period_start: period });
      if (error) throw new DbError(error);
      count++;
    }
    return { count };
  });
}

export async function regenerateStatement(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ carrier_id: z.uuid(), period_start: z.string() }), fd, async ({ carrier_id, period_start }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase.rpc("generate_weekly_statement", { p_carrier_id: carrier_id, p_period_start: period_start });
    if (error) throw new DbError(error);
    return null;
  });
}

export async function addStatementCredit(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    statement_id: z.uuid(),
    kind: z.enum(["credit", "adjustment_charge"]),
    amount: amount("Amount"),
    description: requiredText("Description", 300),
  });
  return runFormAction(schema, fd, async ({ statement_id, kind, amount: value, description }) => {
    const ctx = await requireStaff({ admin: true });
    const { data: st } = await ctx.supabase.from("weekly_statements").select("carrier_id").eq("id", statement_id).single();
    if (!st) throw new AppError("Statement not found.", "not_found");
    const { error } = await ctx.supabase.from("statement_line_items").insert({
      statement_id,
      carrier_id: st.carrier_id,
      line_type: kind === "credit" ? "credit" : "adjustment",
      description,
      amount: kind === "credit" ? -Number(value) : Number(value),
    });
    if (error) throw new DbError(error);
    return null;
  });
}

export async function removeStatementLine(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ line_id: z.uuid() }), fd, async ({ line_id }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase.from("statement_line_items").delete().eq("id", line_id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function issueStatement(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({ statement_id: z.uuid(), due_days: z.coerce.number().int().min(0).max(60), notify: z.preprocess((v) => v === "on", z.boolean()) });
  return runFormAction(schema, fd, async ({ statement_id, due_days, notify }) => {
    const ctx = await requireStaff({ admin: true });
    const { data: invoiceId, error } = await ctx.supabase.rpc("issue_weekly_statement", { p_statement_id: statement_id, p_due_days: due_days });
    if (error) throw new DbError(error);
    if (invoiceId) await trackServer("invoice_created", ctx.userId, { source: "statement" });
    if (notify) await notifyStatementIssued(statement_id);
    return null;
  });
}

export async function voidStatement(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({ statement_id: z.uuid(), void_reason: requiredText("A reason", 1000).min(5, "Give a short reason") });
  return runFormAction(schema, fd, async ({ statement_id, void_reason }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase.from("weekly_statements").update({ status: "void", void_reason }).eq("id", statement_id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function createManualInvoice(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    carrier_id: z.uuid("Choose a carrier"),
    description: requiredText("Description", 300),
    amount: amount("Amount"),
    due_date: formOptionalDate,
    memo: formOptionalText(1000),
  });
  return runFormAction(schema, fd, async ({ carrier_id, description, amount: value, due_date, memo }) => {
    const ctx = await requireStaff({ admin: true });
    const { data: inv, error } = await ctx.supabase.from("invoices").insert({ carrier_id, memo: memo ?? null }).select("id").single();
    if (error || !inv) throw new DbError(error ?? { message: "insert failed" });
    const { error: lineError } = await ctx.supabase.from("invoice_line_items").insert({ invoice_id: inv.id, carrier_id, description, unit_amount: Number(value) });
    if (lineError) throw new DbError(lineError);
    const { error: openError } = await ctx.supabase.from("invoices").update({ status: "open", due_date: due_date ?? null }).eq("id", inv.id);
    if (openError) throw new DbError(openError);
    await trackServer("invoice_created", ctx.userId, { source: "manual" });
    return null;
  });
}

export async function recordManualPayment(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    invoice_id: z.uuid(),
    amount: amount("Amount"),
    method: z.enum(["ach", "check", "wire", "zelle", "other"]),
    reference: formOptionalText(100),
    received_on: formOptionalDate,
    notes: formOptionalText(1000),
  });
  return runFormAction(schema, fd, async (v) => {
    const ctx = await requireStaff({ admin: true });
    const { data: inv } = await ctx.supabase.from("invoices").select("carrier_id").eq("id", v.invoice_id).single();
    if (!inv) throw new AppError("Invoice not found.", "not_found");
    const { data: payment, error } = await ctx.supabase
      .from("payments")
      .insert({
        invoice_id: v.invoice_id,
        carrier_id: inv.carrier_id,
        amount: Number(v.amount),
        method: v.method,
        status: "succeeded",
        reference: v.reference ?? null,
        received_at: v.received_on ? `${v.received_on}T12:00:00Z` : new Date().toISOString(),
        recorded_by: ctx.userId,
        notes: v.notes ?? null,
      })
      .select("id")
      .single();
    if (error || !payment) throw new DbError(error ?? { message: "insert failed" });
    await trackServer("invoice_paid", ctx.userId, { method: v.method });
    await notifyPaymentReceived(payment.id);
    return null;
  });
}

export async function setInvoiceStatus(fd: FormData): Promise<ActionResult<null>> {
  const schema = z
    .object({ invoice_id: z.uuid(), status: z.enum(["void", "uncollectible", "open"]), void_reason: formOptionalText(1000) })
    .refine((v) => v.status !== "void" || (v.void_reason && v.void_reason.length >= 5), { path: ["void_reason"], message: "Give a short reason" });
  return runFormAction(schema, fd, async ({ invoice_id, status, void_reason }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase
      .from("invoices")
      .update({ status, ...(status === "void" ? { void_reason } : {}) })
      .eq("id", invoice_id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function sendInvoiceReminder(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ invoice_id: z.uuid() }), fd, async ({ invoice_id }) => {
    const ctx = await requireStaff();
    const { timezone } = await getOperationsSettings();
    const { data: inv } = await ctx.supabase.from("invoices").select("id, status, due_date").eq("id", invoice_id).single();
    if (!inv || inv.status !== "open") throw new AppError("Only open invoices can be sent.");
    const today = localDate(new Date(), timezone);
    const sent = await notifyInvoiceDue(inv.id, { overdue: Boolean(inv.due_date && inv.due_date < today), dedupeSuffix: `manual:${Date.now()}` });
    if (!sent) throw new AppError("This carrier has no email address or portal owner to send to.");
    return null;
  });
}
