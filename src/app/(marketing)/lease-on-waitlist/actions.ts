"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { business } from "@/config/business";
import { type ActionResult, runAction } from "@/lib/actions";
import { trackServer } from "@/lib/analytics/server";
import { AppError } from "@/lib/errors";
import { looksLikeBot } from "@/lib/security/bot";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { getFeatureFlag } from "@/lib/settings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { type WaitlistInput, waitlistSchema } from "@/lib/validation/public-forms";

export async function joinLeaseOnWaitlist(input: WaitlistInput): Promise<ActionResult<null>> {
  return runAction(waitlistSchema, input, async (data) => {
    if (!business.leaseOn.waitlistEnabled || !(await getFeatureFlag("lease_on_waitlist"))) {
      throw new AppError("The waitlist is closed right now.");
    }
    await enforceRateLimit("waitlist", clientIp(await headers()));
    if (looksLikeBot(data)) return null;

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("lease_on_waitlist").insert({
      full_name: data.full_name,
      email: data.email,
      phone: data.phone || null,
      city: data.city ?? null,
      state: data.state || null,
      cdl_class: data.cdl_class ?? null,
      years_experience: data.years_experience ?? null,
      equipment_interest: data.equipment_interest ?? null,
      owns_truck: data.owns_truck ? data.owns_truck === "yes" : null,
      message: data.message ?? null,
      consent_at: new Date().toISOString(),
    });
    // A repeat sign-up gets the same response so the form cannot be used to test which emails are listed.
    if (error && error.code !== "23505") throw new AppError("We could not save your details. Please try again.");
    if (!error) await trackServer("lease_on_waitlist_signup", randomUUID());
    return null;
  });
}
