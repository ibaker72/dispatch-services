import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { LoadCreateForm } from "./load-form";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";
import { type RawSearchParams, flatParams } from "@/lib/db/query";
import { zoneAbbreviation } from "@/lib/domain/dates";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "New load" };

export default async function NewLoadPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff();
  const { timezone } = await getOperationsSettings();
  const params = flatParams(await searchParams);
  const [carriers, brokers] = await Promise.all([
    ctx.supabase.from("carriers").select("id, legal_name, trucks(equipment_type, status)").eq("status", "active").is("deleted_at", null).order("legal_name"),
    ctx.supabase.from("brokers").select("id, name, mc_number, phone, email, do_not_use").order("name").limit(500),
  ]);
  const options = (carriers.data ?? []).map((c) => ({
    id: c.id,
    legal_name: c.legal_name,
    primary_equipment: c.trucks.find((t) => t.status === "active")?.equipment_type ?? null,
  }));
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/dashboard/loads" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Loads
          </Link>
        }
        title="New load"
        description="Record a load found for a specific contracted carrier. Nothing is booked until the carrier approves it."
      />
      {options.length === 0 ? (
        <Alert tone="info" title="No active carriers">
          Loads can be created only for carriers that are active under a dispatch service agreement.
        </Alert>
      ) : (
        <LoadCreateForm carriers={options} brokers={brokers.data ?? []} defaultCarrierId={params.carrier} zoneLabel={zoneAbbreviation(timezone)} />
      )}
    </>
  );
}
