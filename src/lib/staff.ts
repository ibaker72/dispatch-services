import "server-only";
import type { UserSupabaseClient } from "@/lib/supabase/server";

export interface StaffMember {
  user_id: string;
  full_name: string | null;
  email: string;
  roles: string[];
  grants_all_carriers: boolean;
}

/** Active staff for assignee pickers (RLS-safe RPC; returns nothing for non-staff). */
export async function listStaff(supabase: UserSupabaseClient): Promise<StaffMember[]> {
  const { data } = await supabase.rpc("list_staff_members");
  return (data ?? []) as StaffMember[];
}

export const listDispatchers = async (supabase: UserSupabaseClient) => (await listStaff(supabase)).filter((s) => s.roles.includes("dispatcher"));

export const staffLabel = (s: Pick<StaffMember, "full_name" | "email">) => s.full_name || s.email;
