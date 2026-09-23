import Link from "next/link";
import { LoadStatusBadge } from "@/components/status-badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/domain/dates";
import type { LoadStatus } from "@/lib/domain/load-workflow";
import { formatMoney } from "@/lib/domain/money";
import { formatMiles, formatRate } from "@/lib/domain/mileage";

export interface LoadRow {
  id: string;
  reference: string;
  status: LoadStatus;
  gross_rate: number | null;
  loaded_miles: number | null;
  deadhead_miles: number;
  loaded_rate_per_mile: number | null;
  broker_name: string;
  carriers?: { legal_name: string } | null;
  load_stops?: Array<{ stop_type: string; sequence: number; city: string; state: string; window_start: string | null }>;
}

export function laneOf(stops: LoadRow["load_stops"]): { lane: string; pickup: string | null } {
  const sorted = [...(stops ?? [])].sort((a, b) => a.sequence - b.sequence);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return { lane: "Stops not entered", pickup: null };
  return { lane: `${first.city}, ${first.state} → ${last.city}, ${last.state}`, pickup: first.window_start };
}

/** Load list shared by the dashboard and carrier portal (links go to `${basePath}/${id}`). */
export function LoadsTable({
  loads,
  basePath,
  showCarrier = true,
  showBroker = true,
  audience = "staff",
}: {
  loads: LoadRow[];
  basePath: string;
  showCarrier?: boolean;
  showBroker?: boolean;
  audience?: "staff" | "carrier";
}) {
  return (
    <Table caption="Loads">
      <THead>
        <tr>
          <TH>Load</TH>
          {showCarrier ? <TH>Carrier</TH> : null}
          <TH>Lane</TH>
          <TH>Pickup</TH>
          <TH className="text-right">Rate</TH>
          <TH className="text-right">Miles</TH>
          <TH>Status</TH>
        </tr>
      </THead>
      <tbody>
        {loads.map((l) => {
          const { lane, pickup } = laneOf(l.load_stops);
          return (
            <TR key={l.id}>
              <TD>
                <Link href={`${basePath}/${l.id}`} className="font-semibold text-navy-900 underline-offset-2 hover:underline">
                  {l.reference}
                </Link>
                {showBroker ? <div className="text-xs text-steel-600">{l.broker_name}</div> : null}
              </TD>
              {showCarrier ? <TD>{l.carriers?.legal_name ?? "—"}</TD> : null}
              <TD>{lane}</TD>
              <TD>{pickup ? formatDate(pickup) : "—"}</TD>
              <TD className="text-right tabular-nums">
                {l.gross_rate !== null ? formatMoney(l.gross_rate) : "—"}
                {l.loaded_rate_per_mile !== null ? <div className="text-xs text-steel-600">{formatRate(l.loaded_rate_per_mile)}</div> : null}
              </TD>
              <TD className="text-right tabular-nums">
                {l.loaded_miles !== null ? formatMiles(l.loaded_miles) : "—"}
                {l.deadhead_miles ? <div className="text-xs text-steel-600">+{formatMiles(l.deadhead_miles)} DH</div> : null}
              </TD>
              <TD>
                <LoadStatusBadge status={l.status} audience={audience} />
              </TD>
            </TR>
          );
        })}
      </tbody>
    </Table>
  );
}

export const LOAD_LIST_COLUMNS =
  "id, reference, status, gross_rate, loaded_miles, deadhead_miles, loaded_rate_per_mile, broker_name, carriers(legal_name), load_stops(stop_type, sequence, city, state, window_start)";
