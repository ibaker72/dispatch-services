"use server";

import { z } from "zod";
import { type ActionResult, DbError, runFormAction } from "@/lib/actions";
import { requireStaff } from "@/lib/auth/session";
import { formBool } from "@/lib/validation/common";

/** Lets an admin give a dispatcher access to every carrier (e.g. a team lead). Enforced by RLS helpers. */
export async function setGrantsAllCarriers(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ user_id: z.uuid(), grants_all_carriers: formBool }), fd, async ({ user_id, grants_all_carriers }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase
      .from("user_roles")
      .update({ grants_all_carriers })
      .eq("user_id", user_id)
      .eq("role", "dispatcher")
      .is("revoked_at", null);
    if (error) throw new DbError(error);
    return null;
  });
}
