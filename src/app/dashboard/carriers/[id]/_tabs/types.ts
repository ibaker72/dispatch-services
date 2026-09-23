import type { AuthContext } from "@/lib/auth/session";
import type { Tables } from "@/lib/db/database.types";

export interface CarrierTabProps {
  ctx: AuthContext;
  carrier: Tables<"carriers">;
  admin: boolean;
}
