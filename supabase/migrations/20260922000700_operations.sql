-- =============================================================================
-- Operations: tasks, support requests, communications (also the email
-- outbox), notification preferences, background job runs, rate limiting and
-- the public lease-on waitlist.
-- =============================================================================

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 4000),
  status public.task_status not null default 'open',
  priority public.task_priority not null default 'normal',
  kind text not null default 'general'
    check (kind in ('general', 'follow_up', 'application', 'onboarding', 'documents', 'billing', 'load', 'support')),
  carrier_id uuid references public.carriers (id),
  application_id uuid references public.carrier_applications (id),
  load_id uuid references public.loads (id),
  assigned_to uuid references public.profiles (id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'system')),
  dedupe_key text unique check (char_length(dedupe_key) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_open_idx on public.tasks (status, due_at) where status in ('open', 'in_progress');
create index tasks_assignee_idx on public.tasks (assigned_to, status);
create index tasks_carrier_idx on public.tasks (carrier_id);
create trigger tasks_touch before update on public.tasks for each row execute function app.touch_updated_at();

create or replace function app.guard_task()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and not app.is_system() then
    new.created_by := auth.uid();
    new.source := 'manual';
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end
$$;
create trigger tasks_guard before insert or update on public.tasks for each row execute function app.guard_task();

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers (id),
  load_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  category text not null check (category in ('general', 'load', 'billing', 'documents', 'account', 'cancellation')),
  subject text not null check (char_length(subject) between 3 and 200),
  body text not null check (char_length(body) between 3 and 5000),
  status public.support_status not null default 'open',
  assigned_to uuid references public.profiles (id) on delete set null,
  resolution_note text check (char_length(resolution_note) <= 4000),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (load_id, carrier_id) references public.loads (id, carrier_id)
);
create index support_requests_carrier_idx on public.support_requests (carrier_id, created_at desc);
create index support_requests_open_idx on public.support_requests (status) where status in ('open', 'in_progress', 'waiting_on_carrier');
create trigger support_requests_touch before update on public.support_requests for each row execute function app.touch_updated_at();
create trigger support_requests_carrier_guard before update on public.support_requests
  for each row execute function app.guard_carrier_id_immutable();

create or replace function app.guard_support_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and not app.is_system() then
    new.created_by := auth.uid();
    new.status := 'open';
    new.assigned_to := null;
    new.resolution_note := null;
  end if;
  if new.status in ('resolved', 'closed') and (tg_op = 'INSERT' or old.status not in ('resolved', 'closed')) then
    new.resolved_at := now();
  end if;
  return new;
end
$$;
create trigger support_requests_guard before insert or update on public.support_requests
  for each row execute function app.guard_support_request();

create table public.communications (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid references public.carriers (id),
  application_id uuid references public.carrier_applications (id),
  load_id uuid references public.loads (id),
  channel public.communication_channel not null,
  direction public.communication_direction not null,
  visibility text not null default 'internal' check (visibility in ('internal', 'carrier')),
  template_key text check (char_length(template_key) <= 80),
  subject text check (char_length(subject) <= 300),
  body_text text check (char_length(body_text) <= 50000),
  body_html text check (char_length(body_html) <= 200000),
  to_address text check (char_length(to_address) <= 320),
  status public.delivery_status not null default 'logged',
  provider text check (char_length(provider) <= 40),
  provider_message_id text check (char_length(provider_message_id) <= 200),
  error text check (char_length(error) <= 2000),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  dedupe_key text unique check (char_length(dedupe_key) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index communications_carrier_idx on public.communications (carrier_id, created_at desc);
create index communications_application_idx on public.communications (application_id, created_at desc);
create index communications_retry_idx on public.communications (next_attempt_at) where status = 'failed';
create trigger communications_touch before update on public.communications for each row execute function app.touch_updated_at();

create or replace function app.guard_communication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.is_system() then
    if tg_op = 'UPDATE' then
      raise exception 'communication records are append-only' using errcode = '42501', hint = 'immutable_record';
    end if;
    -- Staff log calls, texts and notes; delivery state is owned by the mailer.
    new.status := 'logged';
    new.created_by := auth.uid();
    new.attempts := 0;
    new.provider := null;
    new.provider_message_id := null;
    new.sent_at := null;
  end if;
  return new;
end
$$;
create trigger communications_guard before insert or update on public.communications
  for each row execute function app.guard_communication();

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in (
    'application_updates', 'load_updates', 'documents', 'billing', 'operations_summary'
  )),
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, category)
);
create trigger notification_preferences_touch before update on public.notification_preferences
  for each row execute function app.touch_updated_at();

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null check (char_length(job_key) <= 80),
  run_key text not null unique check (char_length(run_key) <= 200),
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  triggered_by text not null default 'cron' check (triggered_by in ('cron', 'inngest', 'manual')),
  attempts integer not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  error text check (char_length(error) <= 4000)
);
create index job_runs_job_idx on public.job_runs (job_key, started_at desc);
comment on table public.job_runs is 'rls:service-write-only — written by server-side jobs using the service role; admins read.';

create table public.rate_limit_buckets (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
comment on table public.rate_limit_buckets is 'rls:service-only — accessed exclusively through public.rate_limit_hit() by the server.';

-- Fixed-window counter. Keys are hashed by the server (never raw IPs/emails).
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  win timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  current_hits integer;
begin
  insert into public.rate_limit_buckets as b (key, window_start, hits)
  values (p_key, win, 1)
  on conflict (key, window_start) do update set hits = b.hits + 1
  returning b.hits into current_hits;

  return query select current_hits <= p_limit, greatest(p_limit - current_hits, 0), win + make_interval(secs => p_window_seconds);
end
$$;
revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

create table public.lease_on_waitlist (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 200),
  email extensions.citext not null unique check (char_length(email) <= 254),
  phone text check (char_length(phone) <= 40),
  city text check (char_length(city) <= 100),
  state char(2),
  cdl_class text check (cdl_class in ('A', 'B', 'none')),
  years_experience integer check (years_experience between 0 and 60),
  equipment_interest text references public.equipment_types (key),
  owns_truck boolean,
  message text check (char_length(message) <= 2000),
  consent_at timestamptz not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger lease_on_waitlist_touch before update on public.lease_on_waitlist for each row execute function app.touch_updated_at();
comment on table public.lease_on_waitlist is 'Public sign-ups are inserted by the server (service role) after validation and rate limiting.';

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.tasks enable row level security;
alter table public.support_requests enable row level security;
alter table public.communications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.job_runs enable row level security;
alter table public.rate_limit_buckets enable row level security;
alter table public.lease_on_waitlist enable row level security;

create or replace function app.can_access_task(p_carrier uuid, p_assigned uuid, p_created uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
    or (app.is_dispatcher() and (
      p_assigned = auth.uid()
      or p_created = auth.uid()
      or (p_carrier is not null and app.can_staff_access_carrier(p_carrier))
    ))
$$;

create policy tasks_select on public.tasks for select to authenticated
  using (app.can_access_task(carrier_id, assigned_to, created_by));
create policy tasks_insert on public.tasks for insert to authenticated
  with check ((select app.is_staff()) and (carrier_id is null or app.can_staff_access_carrier(carrier_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (app.can_access_task(carrier_id, assigned_to, created_by))
  with check (app.can_access_task(carrier_id, assigned_to, created_by));

create policy support_requests_select on public.support_requests for select to authenticated
  using (app.can_read_carrier(carrier_id));
create policy support_requests_insert on public.support_requests for insert to authenticated
  with check (app.can_read_carrier(carrier_id));
create policy support_requests_update on public.support_requests for update to authenticated
  using (app.can_staff_access_carrier(carrier_id)) with check (app.can_staff_access_carrier(carrier_id));

create policy communications_select on public.communications for select to authenticated
  using (
    (carrier_id is not null and app.can_staff_access_carrier(carrier_id))
    or (carrier_id is null and (select app.is_staff()))
    or (carrier_id is not null and visibility = 'carrier' and app.is_carrier_member(carrier_id))
  );
create policy communications_insert on public.communications for insert to authenticated
  with check (
    channel in ('phone', 'sms', 'note', 'email')
    and ((carrier_id is not null and app.can_staff_access_carrier(carrier_id)) or (carrier_id is null and (select app.is_staff())))
  );

create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notification_preferences_admin_read on public.notification_preferences for select to authenticated
  using ((select app.is_admin()));

create policy job_runs_select on public.job_runs for select to authenticated using ((select app.is_admin()));

create policy lease_on_waitlist_select on public.lease_on_waitlist for select to authenticated using ((select app.is_admin()));
create policy lease_on_waitlist_update on public.lease_on_waitlist for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

revoke update, delete, truncate on public.communications from authenticated, anon;
revoke all on public.rate_limit_buckets from authenticated, anon;
