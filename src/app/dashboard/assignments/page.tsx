import Link from "next/link";
import { setGrantsAllCarriers } from "./actions";
import { assignDispatcher, endAssignment } from "../carriers/actions";
import { ActionForm, FormDialog, FormField } from "@/components/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";
import { formatDate } from "@/lib/domain/dates";
import { listStaff, staffLabel } from "@/lib/staff";

export const metadata = { title: "Dispatcher assignments" };

export default async function AssignmentsPage() {
  const ctx = await requireStaff({ admin: true });
  const [staff, assignments, carriers] = await Promise.all([
    listStaff(ctx.supabase),
    ctx.supabase.from("dispatcher_assignments").select("id, dispatcher_id, is_primary, assigned_at, carrier_id, carriers(legal_name, status)").is("ended_at", null),
    ctx.supabase.from("carriers").select("id, legal_name, status").is("deleted_at", null).neq("status", "inactive").order("legal_name"),
  ]);
  const dispatchers = staff.filter((s) => s.roles.includes("dispatcher"));
  const rows = assignments.data ?? [];
  const covered = new Set(rows.filter((a) => a.is_primary).map((a) => a.carrier_id));
  const unassigned = (carriers.data ?? []).filter((c) => !covered.has(c.id));

  return (
    <>
      <PageHeader
        title="Dispatcher assignments"
        description="Dispatchers can see and work only the carriers assigned to them, enforced in the database. Grant all-carrier access sparingly."
      />
      {unassigned.length ? (
        <Alert tone="warning" title={`${unassigned.length} carrier${unassigned.length === 1 ? "" : "s"} without a primary dispatcher`} className="mb-6">
          {unassigned.map((c, i) => (
            <span key={c.id}>
              {i ? ", " : ""}
              <Link href={`/dashboard/carriers/${c.id}`} className="underline">
                {c.legal_name}
              </Link>
            </span>
          ))}
        </Alert>
      ) : null}
      {dispatchers.length === 0 ? (
        <Alert tone="info" title="No dispatchers yet">
          Invite dispatchers from Settings → Staff users.
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {dispatchers.map((d) => {
          const mine = rows.filter((a) => a.dispatcher_id === d.user_id);
          return (
            <Card key={d.user_id}>
              <CardHeader>
                <div>
                  <CardTitle>{staffLabel(d)}</CardTitle>
                  <p className="text-sm text-steel-600">{d.email}</p>
                </div>
                {d.grants_all_carriers ? <Badge tone="accent">All carriers</Badge> : <Badge>{mine.length} assigned</Badge>}
              </CardHeader>
              <CardBody className="space-y-4">
                {mine.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {mine.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2">
                        <span>
                          <Link href={`/dashboard/carriers/${a.carrier_id}`} className="font-medium hover:underline">
                            {a.carriers?.legal_name}
                          </Link>
                          {a.is_primary ? <span className="ml-1 text-xs text-steel-600">(primary)</span> : null}
                          <span className="block text-xs text-steel-600">since {formatDate(a.assigned_at)}</span>
                        </span>
                        <ActionForm action={endAssignment} submitLabel="End" submitVariant="ghost" submitSize="sm" inline>
                          <input type="hidden" name="assignment_id" value={a.id} />
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-steel-600">No carriers assigned.</p>
                )}
                <div className="flex flex-wrap items-center gap-3 border-t border-steel-200 pt-4">
                  <FormDialog title={`Assign a carrier to ${staffLabel(d)}`} triggerLabel="Assign carrier" triggerVariant="secondary" triggerSize="sm">
                    <ActionForm action={assignDispatcher} submitLabel="Assign">
                      <input type="hidden" name="dispatcher_id" value={d.user_id} />
                      <FormField id={`carrier-${d.user_id}`} name="carrier_id" label="Carrier" required>
                        <Select name="carrier_id" defaultValue="">
                          <option value="" disabled>
                            Choose…
                          </option>
                          {(carriers.data ?? []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.legal_name}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox name="is_primary" defaultChecked />
                        <span>Primary dispatcher (replaces the current primary)</span>
                      </label>
                    </ActionForm>
                  </FormDialog>
                  <ActionForm action={setGrantsAllCarriers} submitLabel={d.grants_all_carriers ? "Limit to assigned carriers" : "Grant all-carrier access"} submitVariant="ghost" submitSize="sm" inline>
                    <input type="hidden" name="user_id" value={d.user_id} />
                    {d.grants_all_carriers ? null : <input type="hidden" name="grants_all_carriers" value="on" />}
                  </ActionForm>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}
