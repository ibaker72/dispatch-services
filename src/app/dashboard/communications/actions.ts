"use server";

import { z } from "zod";
import { type ActionResult, runFormAction } from "@/lib/actions";
import { requireStaff } from "@/lib/auth/session";
import { retryCommunication } from "@/lib/email/send";
import { AppError } from "@/lib/errors";

export async function retryEmail(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ id: z.uuid() }), fd, async ({ id }) => {
    const ctx = await requireStaff();
    // RLS check first: the caller must be able to see this communication.
    const { data } = await ctx.supabase.from("communications").select("id").eq("id", id).maybeSingle();
    if (!data) throw new AppError("Message not found.", "not_found");
    const result = await retryCommunication(id);
    if (result === "failed") throw new AppError("Delivery failed again. It will be retried automatically.");
    if (result === "skipped") throw new AppError("This message can no longer be retried.");
    return null;
  });
}
