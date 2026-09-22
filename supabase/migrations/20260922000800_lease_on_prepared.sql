-- =============================================================================
-- Future lease-on operations — PREPARED, NOT ACTIVE.
--
-- The company does not currently hold operating authority and does not act as
-- a motor carrier. These tables exist so a future lease-on program can be
-- added without reshaping the data model. They are:
--   * invisible to carrier users (admin-only RLS),
--   * read-only for everyone until the `lease_on_operations` feature flag is
--     enabled, and
--   * the flag cannot be enabled until the readiness checklist is satisfied
--     (USDOT, MC, authority effective date, insurance filing verification,
--     BOC-3 verification, compliance administrator, attorney-approved lease).
-- The application additionally requires LEASE_ON_OPERATIONS_ENABLED=true on
-- the server. Both gates must be open.
-- =============================================================================

create table public.authority_profiles (
  id uuid primary key default gen_random_uuid(),
  kind text not null unique default 'company' check (kind = 'company'),
  legal_name text check (char_length(legal_name) <= 200),
  usdot_number text check (usdot_number ~ '^[0-9]{1,8}$'),
  mc_number text check (mc_number ~ '^[0-9]{1,8}$'),
  authority_effective_date date,
  insurance_filing_verified_at timestamptz,
  insurance_filing_verified_by uuid references public.profiles (id) on delete set null,
  boc3_verified_at timestamptz,
  boc3_verified_by uuid references public.profiles (id) on delete set null,
  compliance_administrator_id uuid references public.profiles (id) on delete set null,
  attorney_approved_lease_version_id uuid references public.agreement_versions (id),
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger authority_profiles_touch before update on public.authority_profiles for each row execute function app.touch_updated_at();
create trigger authority_profiles_audit after insert or update on public.authority_profiles
  for each row execute function app.audit_row_change();

create or replace function app.lease_on_readiness()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ap as (select * from public.authority_profiles where kind = 'company' limit 1)
  select jsonb_build_object(
    'usdot_number', coalesce((select usdot_number is not null from ap), false),
    'mc_number', coalesce((select mc_number is not null from ap), false),
    'authority_effective_date', coalesce((select authority_effective_date is not null from ap), false),
    'insurance_filing_verified', coalesce((select insurance_filing_verified_at is not null from ap), false),
    'boc3_verified', coalesce((select boc3_verified_at is not null from ap), false),
    'compliance_administrator', coalesce((
      select exists (
        select 1 from public.user_roles r
        where r.user_id = ap.compliance_administrator_id and r.revoked_at is null
          and r.role in ('admin', 'super_admin')
      ) from ap), false),
    'attorney_approved_lease_version', coalesce((
      select exists (
        select 1 from public.agreement_versions v
        join public.agreements a on a.id = v.agreement_id
        where v.id = ap.attorney_approved_lease_version_id
          and a.key = 'owner_operator_lease'
          and v.legal_review_status = 'attorney_approved'
      ) from ap), false)
  )
$$;

create or replace function app.lease_on_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from jsonb_each(app.lease_on_readiness()) r where r.value = 'false'::jsonb)
$$;

create or replace function app.lease_on_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select f.enabled from public.feature_flags f where f.key = 'lease_on_operations'), false)
     and app.lease_on_ready()
$$;

create or replace function app.guard_feature_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key <> old.key then
    raise exception 'feature flag keys are immutable' using errcode = '42501';
  end if;
  if new.key = 'lease_on_operations' and new.enabled and not old.enabled and not app.lease_on_ready() then
    raise exception 'lease-on operations cannot be enabled until the compliance checklist is complete: %',
      app.lease_on_readiness() using errcode = '23514', hint = 'lease_on_not_ready';
  end if;
  new.updated_by := auth.uid();
  return new;
end
$$;
create trigger feature_flags_guard before update on public.feature_flags
  for each row execute function app.guard_feature_flag();

create or replace function public.get_lease_on_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'requirements', app.lease_on_readiness(),
    'ready', app.lease_on_ready(),
    'flag_enabled', coalesce((select f.enabled from public.feature_flags f where f.key = 'lease_on_operations'), false)
  );
end
$$;
revoke execute on function public.get_lease_on_readiness() from public, anon;
grant execute on function public.get_lease_on_readiness() to authenticated;

-- ---------------------------------------------------------------------------
-- Prepared tables (no carrier access; writes blocked until enabled)
-- ---------------------------------------------------------------------------
create table public.lease_on_applications (
  id uuid primary key default gen_random_uuid(),
  waitlist_id uuid references public.lease_on_waitlist (id),
  full_name text not null,
  email extensions.citext not null,
  phone text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'under_review', 'approved', 'declined', 'withdrawn')),
  form_data jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.owner_operator_leases (
  id uuid primary key default gen_random_uuid(),
  lease_on_application_id uuid references public.lease_on_applications (id),
  owner_operator_name text not null,
  agreement_version_id uuid references public.agreement_versions (id),
  equipment_description text,
  effective_on date,
  terminated_on date,
  status text not null default 'draft' check (status in ('draft', 'active', 'terminated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.carrier_insurance_policies (
  id uuid primary key default gen_random_uuid(),
  authority_profile_id uuid references public.authority_profiles (id),
  policy_type text not null check (policy_type in ('auto_liability', 'cargo', 'general_liability', 'physical_damage', 'workers_comp', 'other')),
  insurer_name text,
  policy_number text,
  coverage_amount numeric(14, 2),
  effective_on date,
  expires_on date,
  filing_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.driver_qualification_documents (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid references public.owner_operator_leases (id),
  driver_name text not null,
  document_kind text not null check (document_kind in (
    'application', 'mvr', 'road_test', 'medical_certificate', 'previous_employer_inquiry', 'annual_review', 'other'
  )),
  document_id uuid references public.documents (id),
  expires_on date,
  created_at timestamptz not null default now()
);

create table public.compliance_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  area text not null check (area in ('authority', 'insurance', 'driver_qualification', 'drug_alcohol', 'maintenance', 'hours_of_service', 'other')),
  due_on date,
  completed_at timestamptz,
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.vehicle_maintenance_records (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid references public.owner_operator_leases (id),
  vehicle_description text not null,
  service_type text not null,
  performed_on date,
  odometer integer,
  next_due_on date,
  document_id uuid references public.documents (id),
  created_at timestamptz not null default now()
);

create table public.drug_testing_status (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid references public.owner_operator_leases (id),
  driver_name text not null,
  test_type text not null check (test_type in ('pre_employment', 'random', 'post_accident', 'reasonable_suspicion', 'return_to_duty', 'follow_up')),
  status text not null check (status in ('scheduled', 'negative', 'positive', 'refused', 'cancelled')),
  tested_on date,
  consortium_name text,
  created_at timestamptz not null default now()
);

create table public.clearinghouse_query_status (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid references public.owner_operator_leases (id),
  driver_name text not null,
  query_type text not null check (query_type in ('pre_employment_full', 'annual_limited', 'full_follow_up')),
  consent_received_at timestamptz,
  queried_on date,
  result text check (result in ('no_violations', 'violations_found', 'pending')),
  created_at timestamptz not null default now()
);

create table public.eld_provider_connections (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid references public.owner_operator_leases (id),
  provider_name text not null,
  external_account_ref text,
  status text not null default 'pending' check (status in ('pending', 'connected', 'disconnected')),
  connected_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.settlement_deductions (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid references public.owner_operator_leases (id),
  description text not null,
  amount numeric(12, 2) not null check (amount > 0),
  deduction_type text not null check (deduction_type in ('insurance', 'fuel_advance', 'escrow', 'equipment', 'other')),
  settlement_period_start date,
  created_at timestamptz not null default now()
);

create table public.escrow_accounts (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid references public.owner_operator_leases (id),
  target_amount numeric(12, 2),
  balance numeric(12, 2) not null default 0,
  interest_terms text,
  created_at timestamptz not null default now()
);

create table public.safety_events (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid references public.owner_operator_leases (id),
  event_type text not null check (event_type in ('inspection', 'violation', 'accident', 'citation', 'other')),
  occurred_on date,
  description text,
  created_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'lease_on_applications', 'owner_operator_leases', 'carrier_insurance_policies',
    'driver_qualification_documents', 'compliance_tasks', 'vehicle_maintenance_records',
    'drug_testing_status', 'clearinghouse_query_status', 'eld_provider_connections',
    'settlement_deductions', 'escrow_accounts', 'safety_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select app.is_admin()))',
      t || '_select_admin', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select app.is_admin()) and app.lease_on_enabled())',
      t || '_insert_when_enabled', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select app.is_admin()) and app.lease_on_enabled()) with check ((select app.is_admin()) and app.lease_on_enabled())',
      t || '_update_when_enabled', t);
    execute format('comment on table public.%I is %L', t,
      'Prepared for future lease-on operations. Inactive until the lease_on_operations flag and compliance checklist are satisfied.');
    execute format('revoke delete, truncate on public.%I from authenticated, anon', t);
  end loop;
end
$$;

-- The authority profile is the readiness checklist itself, so super admins
-- can maintain it before the program is enabled.
alter table public.authority_profiles enable row level security;
create policy authority_profiles_select on public.authority_profiles for select to authenticated
  using ((select app.is_admin()));
create policy authority_profiles_insert on public.authority_profiles for insert to authenticated
  with check ((select app.is_super_admin()));
create policy authority_profiles_update on public.authority_profiles for update to authenticated
  using ((select app.is_super_admin())) with check ((select app.is_super_admin()));
