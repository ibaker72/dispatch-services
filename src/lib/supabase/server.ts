import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db/database.types";
import { ConfigurationError } from "@/lib/env";

export function supabaseUrlAndKey(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new ConfigurationError("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. See .env.example.");
  }
  return { url, anonKey };
}

/**
 * Per-request Supabase client acting as the signed-in user. Every query made
 * with it is subject to Row Level Security. Create one per request.
 */
export async function createSupabaseServerClient() {
  const { url, anonKey } = supabaseUrlAndKey();
  const cookieStore = await cookies();
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component where cookies are read-only; the
          // proxy refreshes the session on the next request.
        }
      },
    },
  });
}

export type UserSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
