import Link from "next/link";
import type { CarrierTabProps } from "./types";
import { LOAD_LIST_COLUMNS, type LoadRow, LoadsTable } from "@/components/dashboard/loads-table";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

export async function LoadsTab({ ctx, carrier }: CarrierTabProps) {
  const { data } = await ctx.supabase.from("loads").select(LOAD_LIST_COLUMNS).eq("carrier_id", carrier.id).order("created_at", { ascending: false }).limit(50);
  const loads = (data ?? []) as unknown as LoadRow[];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent loads</CardTitle>
        <Link href={`/dashboard/loads?carrier=${carrier.id}`} className="text-sm font-semibold underline">
          Open in load board
        </Link>
      </CardHeader>
      {loads.length ? <LoadsTable loads={loads} basePath="/dashboard/loads" showCarrier={false} /> : <CardBody className="text-sm text-steel-600">No loads yet.</CardBody>}
    </Card>
  );
}
