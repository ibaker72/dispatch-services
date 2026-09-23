"use server";

import { z } from "zod";
import { type ActionResult, DbError, runFormAction } from "@/lib/actions";
import { requireStaff } from "@/lib/auth/session";
import { zonedLocalToIso } from "@/lib/domain/dates";
import { getOperationsSettings } from "@/lib/settings";
import { formOptionalText, formOptionalUuid, requiredText } from "@/lib/validation/common";

const taskFields = {
  title: requiredText("Title", 200),
  description: formOptionalText(4000),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  kind: z.enum(["general", "follow_up", "application", "onboarding", "documents", "billing", "load", "support"]).default("general"),
  carrier_id: formOptionalUuid,
  load_id: formOptionalUuid,
  assigned_to: formOptionalUuid,
  due_at: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Enter a date and time").optional()),
};

export async function createTask(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object(taskFields), fd, async (v) => {
    const ctx = await requireStaff();
    const { timezone } = await getOperationsSettings();
    const { error } = await ctx.supabase.from("tasks").insert({
      title: v.title,
      description: v.description ?? null,
      priority: v.priority,
      kind: v.kind,
      carrier_id: v.carrier_id ?? null,
      load_id: v.load_id ?? null,
      assigned_to: v.assigned_to ?? ctx.userId,
      due_at: v.due_at ? zonedLocalToIso(v.due_at, timezone) : null,
      created_by: ctx.userId,
    });
    if (error) throw new DbError(error);
    return null;
  });
}

export async function updateTask(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    id: z.uuid(),
    status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
    assigned_to: formOptionalUuid,
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  });
  return runFormAction(schema, fd, async ({ id, status, assigned_to, priority }) => {
    const ctx = await requireStaff();
    const { error } = await ctx.supabase
      .from("tasks")
      .update({
        ...(status ? { status, completed_at: status === "done" ? new Date().toISOString() : null } : {}),
        ...(assigned_to ? { assigned_to } : {}),
        ...(priority ? { priority } : {}),
      })
      .eq("id", id);
    if (error) throw new DbError(error);
    return null;
  });
}
