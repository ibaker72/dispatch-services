import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { ConfigurationError } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — use only on the server, only after an
 * explicit authorization decision, and only for operations that cannot run as
 * the user (anonymous application drafts, webhooks, jobs, auth admin calls,
 * storage signing). Never import this from client components.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ConfigurationError("SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL must be set on the server.");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-client-info": "dispatch-services-server" } },
  });
}

export type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>;
