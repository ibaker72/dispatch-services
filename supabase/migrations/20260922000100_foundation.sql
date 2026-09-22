-- =============================================================================
-- Foundation: extensions, private helper schema, enums, identity, roles,
-- settings, feature flags and the append-only audit log.
--
-- Conventions used by every migration in this project:
--   * UUID primary keys, timestamptz (UTC) timestamps, numeric for money/miles.
--   * Row Level Security is enabled on every table in `public`.
--   * Helper functions used by policies live in the private `app` schema,
--     which PostgREST does not expose. They are SECURITY DEFINER with an
--     empty search_path so they cannot be hijacked.
--   * Callable RPCs live in `public`, check authorization themselves and are
--     never executable by `anon`.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- Least privilege for the anonymous API role: nothing in `public` unless a
-- later migration grants it explicitly.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.app_role as enum (
  'super_admin', 'admin', 'dispatcher', 'carrier_owner', 'carrier_member'
);

create type public.application_status as enum (
  'draft', 'submitted', 'under_review', 'information_requested',
  'approved', 'declined', 'onboarding', 'active', 'inactive'
);

create type public.carrier_status as enum ('onboarding', 'active', 'inactive');

create type public.load_status as enum (
  'opportunity', 'proposed', 'approved', 'booked', 'dispatched', 'at_pickup',
  'loaded', 'in_transit', 'delivered', 'paperwork_pending', 'completed', 'cancelled'
);

create type public.fee_model as enum ('percentage', 'flat_weekly');

create type public.document_type as enum (
  'w9', 'certificate_of_insurance', 'operating_authority', 'notice_of_assignment',
  'dispatch_agreement', 'limited_power_of_attorney', 'rate_confirmation',
  'bill_of_lading', 'proof_of_delivery', 'vehicle_inspection_report', 'gate_pass',
  'lumper_receipt', 'scale_ticket', 'driver_license', 'medical_card',
  'truck_registration', 'trailer_registration', 'other'
);

create type public.document_status as enum (
  'uploading', 'pending_review', 'accepted', 'rejected', 'expired', 'superseded'
);

create type public.charge_type as enum ('detention', 'layover', 'tonu', 'lumper_reimbursement', 'other');

create type public.statement_status as enum ('draft', 'issued', 'void');
create type public.invoice_status as enum ('draft', 'open', 'paid', 'void', 'uncollectible');
create type public.payment_method as enum ('stripe', 'ach', 'check', 'wire', 'zelle', 'other');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'refunded');

create type public.task_status as enum ('open', 'in_progress', 'done', 'cancelled');
create type public.task_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.support_status as enum ('open', 'in_progress', 'waiting_on_carrier', 'resolved', 'closed');

create type public.communication_channel as enum ('email', 'sms', 'phone', 'portal', 'note');
create type public.communication_direction as enum ('inbound', 'outbound', 'internal');
create type public.delivery_status as enum ('queued', 'sent', 'failed', 'skipped', 'logged');

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Returns NULL instead of raising for malformed UUID text (used in storage policies).
create or replace function app.try_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return value::uuid;
exception when others then
  return null;
end
$$;

-- True when the current request is not an end-user request: the service role
-- (server-side jobs, webhooks) or a direct database session (migrations, tests
-- run as a database owner). End-user requests always carry an `authenticated`
-- or `anon` role claim verified by PostgREST.
create or replace function app.is_system()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'role', 'system') in ('service_role', 'system')
$$;

-- Internal-operation markers. Ledger functions (statement generation, invoice
-- recalculation, application approval) set a transaction-local marker so guard
-- triggers can distinguish computed writes from direct client edits. The
-- `app` schema is not exposed through the API, so clients cannot set it.
create or replace function app.begin_internal(p_op text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  prev text := coalesce(current_setting('app.internal_op', true), '');
begin
  perform set_config('app.internal_op', p_op, true);
  return prev;
end
$$;

create or replace function app.end_internal(p_prev text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('app.internal_op', coalesce(p_prev, ''), true);
end
$$;

create or replace function app.in_internal(p_op text default null)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.internal_op', true), '') <> ''
     and (p_op is null or current_setting('app.internal_op', true) = p_op)
$$;

-- Returns true when every key that differs between two row images is in
-- `allowed`. Used by guard triggers to implement column-level write rules
-- that depend on the caller's role.
create or replace function app.only_columns_changed(old_row jsonb, new_row jsonb, allowed text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
    select 1
    from jsonb_each(new_row) n
    where n.key <> all (allowed)
      and n.value is distinct from old_row -> n.key
  )
$$;

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email extensions.citext not null,
  full_name text check (char_length(full_name) <= 200),
  phone text check (char_length(phone) <= 40),
  title text check (char_length(title) <= 120),
  timezone text not null default 'America/Chicago' check (char_length(timezone) <= 64),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (email);
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 200), '')
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create or replace function app.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function app.handle_auth_user_email_change();

-- -----------------------------------------------------------------------------
-- Staff roles (super_admin, admin, dispatcher). Carrier roles live on
-- organization_members, so a person is either staff or a carrier user.
-- -----------------------------------------------------------------------------
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null check (role in ('super_admin', 'admin', 'dispatcher')),
  grants_all_carriers boolean not null default false,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  constraint user_roles_all_carriers_dispatcher_only check (not grants_all_carriers or role = 'dispatcher')
);
create unique index user_roles_active_unique on public.user_roles (user_id, role) where revoked_at is null;
create index user_roles_user_idx on public.user_roles (user_id) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- Settings and feature flags
-- -----------------------------------------------------------------------------
create table public.app_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value jsonb not null default '{}'::jsonb,
  description text,
  is_public boolean not null default false,
  is_sensitive boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger app_settings_touch before update on public.app_settings
  for each row execute function app.touch_updated_at();

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  enabled boolean not null default false,
  description text not null,
  is_sensitive boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger feature_flags_touch before update on public.feature_flags
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Role helpers used by RLS policies
-- -----------------------------------------------------------------------------
create or replace function app.has_staff_role(roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = any (roles)
      and ur.revoked_at is null
      and p.deactivated_at is null
  )
$$;

-- When the `security.require_admin_mfa` setting is on, administrative roles
-- only take effect in sessions that completed MFA (JWT aal = aal2).
create or replace function app.admin_mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(
      (select (s.value ->> 'require_admin_mfa')::boolean from public.app_settings s where s.key = 'security'),
      false
    )
    then coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    else true
  end
$$;

create or replace function app.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_staff_role(array['super_admin']::public.app_role[]) and app.admin_mfa_satisfied()
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_staff_role(array['super_admin', 'admin']::public.app_role[]) and app.admin_mfa_satisfied()
$$;

create or replace function app.is_dispatcher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_staff_role(array['dispatcher']::public.app_role[])
$$;

create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin() or app.is_dispatcher()
$$;

create or replace function app.email_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
  )
$$;

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'system', 'service')),
  action text not null check (char_length(action) between 3 and 120),
  entity_type text,
  entity_id text,
  carrier_id uuid,
  severity text not null default 'info' check (severity in ('info', 'notice', 'warning', 'security')),
  ip_address inet,
  user_agent text check (char_length(user_agent) <= 512),
  request_id text,
  metadata jsonb not null default '{}'::jsonb
);
create index audit_events_occurred_idx on public.audit_events (occurred_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create index audit_events_carrier_idx on public.audit_events (carrier_id, occurred_at desc) where carrier_id is not null;
create index audit_events_actor_idx on public.audit_events (actor_id, occurred_at desc);
create index audit_events_security_idx on public.audit_events (occurred_at desc) where severity = 'security';

create or replace function app.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only; % is not permitted', tg_table_name, lower(tg_op)
    using errcode = 'P0001', hint = 'immutable_record';
end
$$;

create trigger audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function app.prevent_mutation();

create or replace function app.audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_carrier_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_severity text default 'info'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (actor_id, actor_kind, action, entity_type, entity_id, carrier_id, severity, metadata)
  values (
    auth.uid(),
    case when auth.uid() is not null then 'user' when app.is_system() then 'system' else 'service' end,
    p_action, p_entity_type, p_entity_id, p_carrier_id, p_severity, coalesce(p_metadata, '{}'::jsonb)
  );
end
$$;

-- Generic row-change audit trigger. TG_ARGV[0] (optional) is a comma list of
-- columns whose values must never be copied into the audit log.
create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  redacted text[] := case when tg_nargs > 0 then string_to_array(tg_argv[0], ',') else array[]::text[] end;
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  changes jsonb := '{}'::jsonb;
  k text;
  row_id text;
  row_carrier uuid;
begin
  row_id := coalesce(new_row ->> 'id', old_row ->> 'id', new_row ->> 'key', old_row ->> 'key', new_row ->> 'load_id');
  row_carrier := app.try_uuid(coalesce(new_row ->> 'carrier_id', old_row ->> 'carrier_id'));
  if tg_table_name = 'carriers' then
    row_carrier := app.try_uuid(row_id);
  end if;

  for k in select jsonb_object_keys(new_row || old_row) loop
    continue when k in ('updated_at', 'created_at');
    if (new_row -> k) is distinct from (old_row -> k) then
      if k = any (redacted) then
        changes := changes || jsonb_build_object(k, '[redacted]');
      elsif tg_op = 'UPDATE' then
        changes := changes || jsonb_build_object(k, jsonb_build_array(old_row -> k, new_row -> k));
      else
        changes := changes || jsonb_build_object(k, coalesce(new_row -> k, old_row -> k));
      end if;
    end if;
  end loop;

  if tg_op = 'UPDATE' and changes = '{}'::jsonb then
    return null;
  end if;

  perform app.audit(
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    row_id,
    row_carrier,
    jsonb_build_object('changes', changes)
  );
  return null;
end
$$;

-- Security events a signed-in user may record about their own session.
create or replace function public.log_security_event(p_action text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_action not in (
    'auth.login', 'auth.logout', 'auth.password_changed', 'auth.mfa_enrolled',
    'auth.mfa_verified', 'auth.mfa_unenrolled', 'auth.magic_link_login'
  ) then
    raise exception 'unsupported security event' using errcode = '22023';
  end if;
  insert into public.audit_events (actor_id, actor_kind, action, entity_type, entity_id, severity, metadata)
  values (auth.uid(), 'user', p_action, 'user', auth.uid()::text, 'security',
          jsonb_strip_nulls(jsonb_build_object('aal', auth.jwt() ->> 'aal', 'detail', left(p_metadata ->> 'detail', 200))));
end
$$;

-- -----------------------------------------------------------------------------
-- Role management guards
-- -----------------------------------------------------------------------------
create or replace function app.guard_user_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.role <> old.role then
      raise exception 'role assignments cannot be re-targeted; revoke and grant instead' using errcode = '22023';
    end if;
  end if;

  -- Never leave the platform without an active super administrator.
  if tg_op = 'UPDATE' and old.role = 'super_admin' and old.revoked_at is null and new.revoked_at is not null then
    if not exists (
      select 1 from public.user_roles
      where role = 'super_admin' and revoked_at is null and id <> old.id
    ) then
      raise exception 'at least one active super_admin is required' using errcode = '23514';
    end if;
  end if;

  -- Staff and carrier memberships are mutually exclusive.
  if new.revoked_at is null and exists (
    select 1 from public.organization_members m where m.user_id = new.user_id and m.status = 'active'
  ) then
    raise exception 'carrier users cannot hold staff roles' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if old.revoked_at is null and new.revoked_at is not null and new.revoked_by is null then
      new.revoked_by := auth.uid();
    end if;
  elsif new.granted_by is null then
    new.granted_by := auth.uid();
  end if;
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- Organizations and membership
-- -----------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'carrier' check (kind in ('carrier')),
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_touch before update on public.organizations
  for each row execute function app.touch_updated_at();

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null check (role in ('carrier_owner', 'carrier_member')),
  status text not null default 'active' check (status in ('active', 'removed')),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete set null,
  unique (organization_id, user_id)
);
-- One active carrier organization per user keeps portal scoping unambiguous.
create unique index organization_members_one_active_org on public.organization_members (user_id) where status = 'active';
create index organization_members_org_idx on public.organization_members (organization_id) where status = 'active';

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email extensions.citext not null check (char_length(email) <= 254),
  role public.app_role not null check (role in ('carrier_owner', 'carrier_member')),
  token_hash text not null unique check (char_length(token_hash) = 64),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  constraint organization_invitations_expiry check (expires_at > created_at)
);
create index organization_invitations_org_idx on public.organization_invitations (organization_id);
create unique index organization_invitations_pending_unique
  on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

create or replace function app.guard_organization_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.user_id <> old.user_id then
      raise exception 'membership cannot be moved between organizations or users' using errcode = '22023';
    end if;
    if new.status = 'removed' and old.status = 'active' then
      new.removed_at := coalesce(new.removed_at, now());
      new.removed_by := coalesce(new.removed_by, auth.uid());
    end if;
    -- Keep at least one active owner.
    if old.role = 'carrier_owner' and old.status = 'active'
       and (new.status <> 'active' or new.role <> 'carrier_owner')
       and not exists (
         select 1 from public.organization_members m
         where m.organization_id = old.organization_id and m.role = 'carrier_owner'
           and m.status = 'active' and m.id <> old.id
       ) then
      raise exception 'an organization must keep at least one active owner' using errcode = '23514';
    end if;
  end if;

  if new.status = 'active' and exists (
    select 1 from public.user_roles r where r.user_id = new.user_id and r.revoked_at is null
  ) then
    raise exception 'staff users cannot be carrier members' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger organization_members_guard
  before insert or update on public.organization_members
  for each row execute function app.guard_organization_members();

create trigger user_roles_guard
  before insert or update on public.user_roles
  for each row execute function app.guard_user_roles();

create trigger user_roles_immutable_delete
  before delete on public.user_roles
  for each row execute function app.prevent_mutation();

create trigger user_roles_audit after insert or update on public.user_roles
  for each row execute function app.audit_row_change();
create trigger organization_members_audit after insert or update on public.organization_members
  for each row execute function app.audit_row_change();
create trigger organization_invitations_audit after insert or update on public.organization_invitations
  for each row execute function app.audit_row_change('token_hash');
create trigger app_settings_audit after insert or update or delete on public.app_settings
  for each row execute function app.audit_row_change();
create trigger feature_flags_audit after insert or update or delete on public.feature_flags
  for each row execute function app.audit_row_change();

create or replace function app.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  ) and app.email_verified()
$$;

create or replace function app.is_org_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid()
      and m.status = 'active' and m.role = 'carrier_owner'
  ) and app.email_verified()
$$;

-- -----------------------------------------------------------------------------
-- RLS: foundation tables
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.app_settings enable row level security;
alter table public.feature_flags enable row level security;
alter table public.audit_events enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;

-- user_roles
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_admin()));
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check ((select app.is_super_admin()) or ((select app.is_admin()) and role = 'dispatcher'));
create policy user_roles_update on public.user_roles for update to authenticated
  using ((select app.is_super_admin()) or ((select app.is_admin()) and role = 'dispatcher'))
  with check ((select app.is_super_admin()) or ((select app.is_admin()) and role = 'dispatcher'));

-- app_settings: public keys readable by anyone; sensitive keys writable only by super_admin.
create policy app_settings_select_public on public.app_settings for select to anon, authenticated
  using (is_public);
create policy app_settings_select_staff on public.app_settings for select to authenticated
  using ((select app.is_staff()));
create policy app_settings_insert on public.app_settings for insert to authenticated
  with check ((select app.is_super_admin()));
create policy app_settings_update on public.app_settings for update to authenticated
  using ((select app.is_super_admin()) or ((select app.is_admin()) and not is_sensitive))
  with check ((select app.is_super_admin()) or ((select app.is_admin()) and not is_sensitive));

-- feature_flags
create policy feature_flags_select on public.feature_flags for select to authenticated
  using ((select app.is_staff()));
create policy feature_flags_update on public.feature_flags for update to authenticated
  using ((select app.is_super_admin()) or ((select app.is_admin()) and not is_sensitive))
  with check ((select app.is_super_admin()) or ((select app.is_admin()) and not is_sensitive));

-- audit_events: administrators read; writes only through triggers/app.audit.
create policy audit_events_select on public.audit_events for select to authenticated
  using ((select app.is_admin()));

-- Organization, membership, invitation and profile policies are defined in the
-- carriers migration because staff visibility depends on dispatcher assignments.

-- Append-only enforcement at the privilege layer as well.
revoke update, delete, truncate on public.audit_events from authenticated, anon, service_role;
grant select on public.app_settings to anon;

grant execute on function public.log_security_event(text, jsonb) to authenticated;
revoke execute on function public.log_security_event(text, jsonb) from anon, public;
