import { ListChecks } from "lucide-react";
import Link from "next/link";
import { createTask, updateTask } from "./actions";
import { ActionForm, FormDialog, FormField } from "@/components/action-form";
import { FilterTabs, Pagination } from "@/components/dashboard/filters";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";
import { PAGE_SIZE, type RawSearchParams, flatParams, pageParam, pageRange } from "@/lib/db/query";
import { formatDateTime, zoneAbbreviation } from "@/lib/domain/dates";
import { TASK_PRIORITY_LABELS } from "@/lib/domain/labels";
import { getOperationsSettings } from "@/lib/settings";
import { listStaff, staffLabel } from "@/lib/staff";

export const metadata = { title: "Tasks" };

const PRIORITY_TONE = { low: "neutral", normal: "info", high: "warning", urgent: "danger" } as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff();
  const params = flatParams(await searchParams);
  const view = params.view === "all" ? "all" : params.view === "done" ? "done" : "mine";
  const page = pageParam(params.page);
  const [from, to] = pageRange(page);
  const { timezone } = await getOperationsSettings();

  let query = ctx.supabase
    .from("tasks")
    .select("id, title, description, status, priority, kind, due_at, created_at, source, assigned_to, carrier_id, load_id, application_id, carriers(legal_name), loads(reference)", { count: "exact" });
  if (view === "done") query = query.in("status", ["done", "cancelled"]).order("updated_at", { ascending: false });
  else {
    query = query.in("status", ["open", "in_progress"]).order("due_at", { ascending: true, nullsFirst: false }).order("created_at");
    if (view === "mine") query = query.eq("assigned_to", ctx.userId);
  }
  const [{ data, count }, staff, carriers] = await Promise.all([
    query.range(from, to),
    listStaff(ctx.supabase),
    ctx.supabase.from("carriers").select("id, legal_name").is("deleted_at", null).order("legal_name"),
  ]);
  const staffName = new Map(staff.map((s) => [s.user_id, staffLabel(s)]));
  const now = new Date().toISOString();

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Follow-ups for onboarding, documents, billing and loads. System tasks are created automatically by workflows."
        actions={
          <FormDialog title="New task" triggerLabel="New task">
            <ActionForm action={createTask} submitLabel="Create task" resetOnSuccess>
              <FormField id="t-title" name="title" label="Title" required>
                <Input name="title" maxLength={200} />
              </FormField>
              <FormField id="t-desc" name="description" label="Details">
                <Textarea name="description" rows={3} maxLength={4000} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="t-priority" name="priority" label="Priority">
                  <Select name="priority" defaultValue="normal">
                    {Object.entries(TASK_PRIORITY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField id="t-due" name="due_at" label={`Due (${zoneAbbreviation(timezone)})`}>
                  <Input name="due_at" type="datetime-local" />
                </FormField>
                <FormField id="t-assignee" name="assigned_to" label="Assign to">
                  <Select name="assigned_to" defaultValue={ctx.userId}>
                    {staff.map((s) => (
                      <option key={s.user_id} value={s.user_id}>
                        {staffLabel(s)}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField id="t-carrier" name="carrier_id" label="Carrier">
                  <Select name="carrier_id" defaultValue="">
                    <option value="">None</option>
                    {(carriers.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.legal_name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
            </ActionForm>
          </FormDialog>
        }
      />
      <FilterTabs
        base="/dashboard/tasks"
        params={{ ...params, view: view === "mine" ? undefined : view }}
        name="view"
        label="Task views"
        options={[
          { value: undefined, label: "Assigned to me" },
          { value: "all", label: "All open" },
          { value: "done", label: "Completed" },
        ]}
      />
      {data && data.length ? (
        <Card>
          <ul className="divide-y divide-steel-100">
            {data.map((t) => {
              const overdue = t.due_at && t.due_at < now && (t.status === "open" || t.status === "in_progress");
              return (
                <li key={t.id} id={`task-${t.id}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {t.title} <Badge tone={PRIORITY_TONE[t.priority]}>{TASK_PRIORITY_LABELS[t.priority]}</Badge> <StatusBadge status={t.status} />
                    </p>
                    {t.description ? <p className="mt-1 text-sm text-steel-700">{t.description}</p> : null}
                    <p className="mt-1 text-xs text-steel-600">
                      {t.carriers && t.carrier_id ? (
                        <Link href={`/dashboard/carriers/${t.carrier_id}`} className="underline">
                          {t.carriers.legal_name}
                        </Link>
                      ) : null}
                      {t.loads && t.load_id ? (
                        <>
                          {" · "}
                          <Link href={`/dashboard/loads/${t.load_id}`} className="underline">
                            Load {t.loads.reference}
                          </Link>
                        </>
                      ) : null}
                      {t.application_id ? (
                        <>
                          {" · "}
                          <Link href={`/dashboard/applications/${t.application_id}`} className="underline">
                            Application
                          </Link>
                        </>
                      ) : null}
                      {" · "}
                      {t.assigned_to ? `Assigned to ${staffName.get(t.assigned_to) ?? "staff"}` : "Unassigned"}
                      {t.due_at ? <span className={overdue ? "font-semibold text-danger" : undefined}> · due {formatDateTime(t.due_at, timezone)}</span> : null}
                      {t.source === "system" ? " · automatic" : ""}
                    </p>
                  </div>
                  {t.status === "open" || t.status === "in_progress" ? (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {t.status === "open" ? (
                        <ActionForm action={updateTask} submitLabel="Start" submitVariant="secondary" submitSize="sm" inline>
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="status" value="in_progress" />
                        </ActionForm>
                      ) : null}
                      <ActionForm action={updateTask} submitLabel="Done" submitSize="sm" inline>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="status" value="done" />
                      </ActionForm>
                      <FormDialog title="Reassign task" triggerLabel="Reassign" triggerVariant="ghost" triggerSize="sm">
                        <ActionForm action={updateTask} submitLabel="Save">
                          <input type="hidden" name="id" value={t.id} />
                          <FormField id={`assign-${t.id}`} name="assigned_to" label="Assign to">
                            <Select name="assigned_to" defaultValue={t.assigned_to ?? ""}>
                              {staff.map((s) => (
                                <option key={s.user_id} value={s.user_id}>
                                  {staffLabel(s)}
                                </option>
                              ))}
                            </Select>
                          </FormField>
                        </ActionForm>
                      </FormDialog>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <EmptyState icon={ListChecks} title={view === "mine" ? "No open tasks assigned to you" : "No tasks"} />
      )}
      <Pagination base="/dashboard/tasks" params={{ ...params, view: view === "mine" ? undefined : view }} page={page} hasNext={(count ?? 0) > page * PAGE_SIZE} total={count} />
    </>
  );
}
