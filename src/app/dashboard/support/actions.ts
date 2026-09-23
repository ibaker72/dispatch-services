"use server";

import { z } from "zod";
import { type ActionResult, DbError, runFormAction } from "@/lib/actions";
import { requireStaff } from "@/lib/auth/session";
import { sendEmailSafely } from "@/lib/email/send";
import { AppError } from "@/lib/errors";
import { absoluteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formBool, formOptionalText, formOptionalUuid } from "@/lib/validation/common";
import { titleCase } from "@/lib/utils";

export async function updateSupportRequest(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    id: z.uuid(),
    status: z.enum(["open", "in_progress", "waiting_on_carrier", "resolved", "closed"]),
    assigned_to: formOptionalUuid,
    resolution_note: formOptionalText(4000),
    notify: formBool,
  });
  return runFormAction(schema, fd, async ({ id, status, assigned_to, resolution_note, notify }) => {
    const ctx = await requireStaff();
    const { data: req } = await ctx.supabase.from("support_requests").select("id, subject, carrier_id, created_by").eq("id", id).maybeSingle();
    if (!req) throw new AppError("Request not found.", "not_found");
    const { error } = await ctx.supabase
      .from("support_requests")
      .update({
        status,
        assigned_to: assigned_to ?? null,
        resolution_note: resolution_note ?? null,
        resolved_at: status === "resolved" || status === "closed" ? new Date().toISOString() : null,
      })
      .eq("id", id);
    if (error) throw new DbError(error);
    if (notify && resolution_note && req.created_by) {
      const { data: requester } = await createSupabaseAdminClient().from("profiles").select("email, full_name").eq("id", req.created_by).single();
      if (requester) {
        await sendEmailSafely({
          to: requester.email,
          template: "support_request_update",
          data: {
            name: requester.full_name ?? "there",
            subject: req.subject,
            statusLabel: titleCase(status),
            message: resolution_note,
            portalUrl: absoluteUrl(`/portal/support`),
          },
          carrierId: req.carrier_id,
          visibility: "carrier",
        });
      }
    }
    return null;
  });
}
