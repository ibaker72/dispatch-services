"use server";

import { z } from "zod";
import { type ActionResult, DbError, runFormAction } from "@/lib/actions";
import { requireStaff } from "@/lib/auth/session";

export async function setWaitlistStatus(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ id: z.uuid(), status: z.enum(["new", "contacted", "archived"]) }), fd, async ({ id, status }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase.from("lease_on_waitlist").update({ status }).eq("id", id);
    if (error) throw new DbError(error);
    return null;
  });
}
