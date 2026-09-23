import { SYSTEM, commitTx } from "../../db/support/harness";
import type { CarrierWorld } from "../../db/support/world";

/** Creates an open dispatch-service invoice for a carrier (via the ledger path used by the app). */
export async function createOpenInvoice(cw: CarrierWorld, amount: string, dueInDays = 7): Promise<string> {
  return commitTx(async (tx) => {
    const { id } = await tx.one<{ id: string }>(SYSTEM, `insert into public.invoices (carrier_id, memo) values ($1, 'Integration test') returning id`, [cw.carrierId]);
    await tx.query(SYSTEM, `insert into public.invoice_line_items (invoice_id, carrier_id, description, unit_amount) values ($1, $2, 'Dispatch fees', $3)`, [id, cw.carrierId, amount]);
    await tx.query(SYSTEM, `update public.invoices set status = 'open', due_date = app.business_today() + $2::int where id = $1`, [id, dueInDays]);
    return id;
  });
}
