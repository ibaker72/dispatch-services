import type { CarrierTabProps } from "./types";
import { logCommunication } from "../../actions";
import { ActionForm, FormDialog, FormField } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { formatDateTime } from "@/lib/domain/dates";
import { SUPPORT_CATEGORIES } from "@/lib/domain/labels";
import { getOperationsSettings } from "@/lib/settings";

export async function ActivityTab({ ctx, carrier }: CarrierTabProps) {
  const { timezone } = await getOperationsSettings();
  const [comms, support, tasks] = await Promise.all([
    ctx.supabase
      .from("communications")
      .select("id, channel, direction, subject, body_text, status, template_key, to_address, created_at, profiles!communications_created_by_fkey(full_name, email)")
      .eq("carrier_id", carrier.id)
      .order("created_at", { ascending: false })
      .limit(50),
    ctx.supabase.from("support_requests").select("id, subject, category, status, created_at").eq("carrier_id", carrier.id).order("created_at", { ascending: false }).limit(10),
    ctx.supabase.from("tasks").select("id, title, status, priority, due_at").eq("carrier_id", carrier.id).in("status", ["open", "in_progress"]).order("due_at", { nullsFirst: false }).limit(10),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <CardTitle>Communication history</CardTitle>
          <FormDialog title="Log a call, text or note" triggerLabel="Log activity" triggerVariant="secondary" triggerSize="sm">
            <ActionForm action={logCommunication} submitLabel="Save to history" resetOnSuccess>
              <input type="hidden" name="carrier_id" value={carrier.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="channel" name="channel" label="Type" required>
                  <Select name="channel" defaultValue="phone">
                    <option value="phone">Phone call</option>
                    <option value="sms">Text message</option>
                    <option value="email">Email (sent outside the system)</option>
                    <option value="note">Internal note</option>
                  </Select>
                </FormField>
                <FormField id="direction" name="direction" label="Direction">
                  <Select name="direction" defaultValue="outbound">
                    <option value="outbound">We contacted the carrier</option>
                    <option value="inbound">The carrier contacted us</option>
                  </Select>
                </FormField>
              </div>
              <FormField id="subject" name="subject" label="Subject">
                <Input name="subject" maxLength={300} />
              </FormField>
              <FormField id="body_text" name="body_text" label="Details" required>
                <Textarea name="body_text" rows={4} maxLength={5000} />
              </FormField>
            </ActionForm>
          </FormDialog>
        </CardHeader>
        {(comms.data ?? []).length ? (
          <ol className="divide-y divide-steel-100">
            {comms.data!.map((c) => (
              <li key={c.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {c.subject ?? (c.channel === "note" ? "Internal note" : c.channel)}
                    <span className="ml-2 text-xs font-normal text-steel-600">
                      {c.channel} · {c.direction}
                      {c.profiles ? ` · ${c.profiles.full_name ?? c.profiles.email}` : c.template_key ? " · automated" : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-steel-600">
                    {formatDateTime(c.created_at, timezone)} <StatusBadge status={c.status} />
                  </span>
                </div>
                {c.channel !== "email" || !c.template_key ? <p className="mt-1 whitespace-pre-line text-steel-800">{c.body_text?.slice(0, 1200)}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <CardBody className="text-sm text-steel-600">No communication recorded yet.</CardBody>
        )}
      </Card>
      <aside className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Open tasks</CardTitle>
          </CardHeader>
          <CardBody>
            {(tasks.data ?? []).length ? (
              <ul className="space-y-2 text-sm">
                {tasks.data!.map((t) => (
                  <li key={t.id}>
                    <a href={`/dashboard/tasks#task-${t.id}`} className="font-medium underline-offset-2 hover:underline">
                      {t.title}
                    </a>
                    <span className="block text-xs text-steel-600">
                      {t.priority} priority{t.due_at ? ` · due ${formatDateTime(t.due_at, timezone)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-steel-600">No open tasks.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Support requests</CardTitle>
          </CardHeader>
          <CardBody>
            {(support.data ?? []).length ? (
              <ul className="space-y-2 text-sm">
                {support.data!.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-2">
                    <a href={`/dashboard/support/${s.id}`} className="font-medium underline-offset-2 hover:underline">
                      {s.subject}
                      <span className="block text-xs font-normal text-steel-600">{SUPPORT_CATEGORIES[s.category as keyof typeof SUPPORT_CATEGORIES] ?? s.category}</span>
                    </a>
                    <StatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-steel-600">No support requests.</p>
            )}
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}
