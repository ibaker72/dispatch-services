import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { UserSupabaseClient } from "@/lib/supabase/server";

/** A PostgREST client acting as `userId`, using a locally signed short-lived JWT. */
export function clientAs(userId: string, aal: "aal1" | "aal2" = "aal1"): UserSupabaseClient {
  const secret = process.env.LOCAL_STACK_JWT_SECRET;
  if (!secret) throw new Error("LOCAL_STACK_JWT_SECRET missing; restart the local stack to regenerate .local-stack/env");
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: userId, role: "authenticated", aud: "authenticated", aal, iat: now, exp: now + 600 });
  const token = `${header}.${body}.${createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")}`;
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as UserSupabaseClient;
}
