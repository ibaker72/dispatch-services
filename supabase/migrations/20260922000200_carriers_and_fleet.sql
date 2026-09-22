-- =============================================================================
-- Carriers, applications, dispatcher assignments and fleet.
-- =============================================================================

create table public.equipment_types (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null check (char_length(label) between 1 and 80),
  description text check (char_length(description) <= 500),
  is_primary boolean not null default false,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger equipment_types_touch before update on public.equipment_types
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Carrier applications. Anonymous applicants never touch this table directly:
-- the server reads/writes drafts with the service role after validating the
-- httpOnly draft cookie (whose SHA-256 is stored in resume_token_hash).
-- -----------------------------------------------------------------------------
create table public.carrier_applications (
  id uuid primary key default gen_random_uuid(),
  status public.application_status not null default 'draft',
  resume_token_hash text unique check (resume_token_hash is null or char_length(resume_token_hash) = 64),
  resume_token_expires_at timestamptz,
  current_step smallint not null default 1 check (current_step between 1 and 9),
  completed_steps smallint[] not null default '{}',
  -- Searchable copies of key answers (source of truth is form_data).
  email extensions.citext check (char_length(email) <= 254),
  contact_name text check (char_length(contact_name) <= 200),
  phone text check (char_length(phone) <= 40),
  legal_name text check (char_length(legal_name) <= 200),
  dba_name text check (char_length(dba_name) <= 200),
  mc_number text check (char_length(mc_number) <= 20),
  usdot_number text check (char_length(usdot_number) <= 20),
  primary_equipment_type text references public.equipment_types (key),
  truck_count integer check (truck_count between 0 and 500),
  home_base_state char(2),
  form_data jsonb not null default '{}'::jsonb,
  consent_version text,
  consent_accepted_at timestamptz,
  consent_ip inet,
  consent_user_agent text check (char_length(consent_user_agent) <= 512),
  submitted_at timestamptz,
  last_activity_at timestamptz not null default now(),
  assigned_reviewer uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  information_request text check (char_length(information_request) <= 4000),
  decision_reason text check (char_length(decision_reason) <= 4000),
  internal_notes text check (char_length(internal_notes) <= 8000),
  carrier_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carrier_applications_submitted_has_consent
    check (status = 'draft' or (consent_accepted_at is not null and submitted_at is not null))
);
create index carrier_applications_status_idx on public.carrier_applications (status, submitted_at desc);
create index carrier_applications_email_idx on public.carrier_applications (email);
create trigger carrier_applications_touch before update on public.carrier_applications
  for each row execute function app.touch_updated_at();

create or replace function app.guard_application_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  allowed := case old.status
    when 'draft' then new.status = 'submitted'
    when 'submitted' then new.status in ('under_review', 'information_requested', 'approved', 'declined')
    when 'under_review' then new.status in ('information_requested', 'approved', 'declined')
    when 'information_requested' then new.status in ('submitted', 'under_review', 'declined')
    when 'approved' then new.status in ('onboarding', 'inactive')
    when 'onboarding' then new.status in ('active', 'inactive')
    when 'active' then new.status = 'inactive'
    when 'inactive' then new.status in ('active', 'onboarding')
    when 'declined' then new.status = 'under_review'
    else false
  end;
  if not allowed then
    raise exception 'invalid application status transition % -> %', old.status, new.status
      using errcode = '23514', hint = 'invalid_transition';
  end if;
  if new.status in ('approved', 'declined', 'information_requested') then
    new.reviewed_at := now();
    new.reviewed_by := coalesce(auth.uid(), new.reviewed_by);
  end if;
  if new.status = 'submitted' then
    new.submitted_at := coalesce(new.submitted_at, now());
  end if;
  return new;
end
$$;

create trigger carrier_applications_status_guard
  before update of status on public.carrier_applications
  for each row execute function app.guard_application_status();

create trigger carrier_applications_audit after update on public.carrier_applications
  for each row execute function app.audit_row_change('form_data,resume_token_hash,consent_ip,consent_user_agent,internal_notes');

-- -----------------------------------------------------------------------------
-- Carriers (one per carrier organization)
-- -----------------------------------------------------------------------------
create table public.carriers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id),
  application_id uuid unique references public.carrier_applications (id),
  status public.carrier_status not null default 'onboarding',
  legal_name text not null check (char_length(legal_name) between 1 and 200),
  dba_name text check (char_length(dba_name) <= 200),
  mc_number text check (char_length(mc_number) <= 20),
  usdot_number text check (char_length(usdot_number) <= 20),
  ein_last4 char(4) check (ein_last4 ~ '^[0-9]{4}$'),
  years_in_business numeric(4, 1) check (years_in_business >= 0 and years_in_business < 200),
  authority_active_date date,
  email extensions.citext check (char_length(email) <= 254),
  phone text check (char_length(phone) <= 40),
  address_line1 text check (char_length(address_line1) <= 200),
  address_line2 text check (char_length(address_line2) <= 200),
  city text check (char_length(city) <= 100),
  state char(2),
  postal_code text check (char_length(postal_code) <= 10),
  home_base_city text check (char_length(home_base_city) <= 100),
  home_base_state char(2),
  -- Operating preferences (carrier-editable)
  min_rate_per_mile numeric(8, 2) check (min_rate_per_mile >= 0 and min_rate_per_mile < 100),
  desired_weekly_gross numeric(12, 2) check (desired_weekly_gross >= 0),
  days_available text[] not null default '{}'
    check (days_available <@ array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  max_deadhead_miles integer check (max_deadhead_miles between 0 and 2000),
  preferences_notes text check (char_length(preferences_notes) <= 2000),
  -- Factoring (the dispatch company never receives freight payments)
  factoring_status text not null default 'unknown'
    check (factoring_status in ('unknown', 'none', 'factoring', 'quick_pay')),
  factoring_company_name text check (char_length(factoring_company_name) <= 200),
  noa_on_file boolean not null default false,
  insurance_expiration_date date,
  authority_verification_status text not null default 'unverified'
    check (authority_verification_status in ('unverified', 'verified', 'failed')),
  authority_verified_at timestamptz,
  authority_verified_by uuid references public.profiles (id) on delete set null,
  authority_verification_notes text check (char_length(authority_verification_notes) <= 2000),
  activated_at timestamptz,
  activated_by uuid references public.profiles (id) on delete set null,
  cancellation_requested_at timestamptz,
  cancellation_requested_by uuid references public.profiles (id) on delete set null,
  cancellation_effective_date date,
  cancellation_reason text check (char_length(cancellation_reason) <= 2000),
  deactivated_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index carriers_status_idx on public.carriers (status) where deleted_at is null;
create index carriers_mc_idx on public.carriers (mc_number);
create index carriers_dot_idx on public.carriers (usdot_number);
create trigger carriers_touch before update on public.carriers
  for each row execute function app.touch_updated_at();

alter table public.carrier_applications
  add constraint carrier_applications_carrier_fk foreign key (carrier_id) references public.carriers (id);

-- -----------------------------------------------------------------------------
-- Dispatcher assignments
-- -----------------------------------------------------------------------------
create table public.dispatcher_assignments (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers (id),
  dispatcher_id uuid not null references public.profiles (id),
  is_primary boolean not null default false,
  note text check (char_length(note) <= 1000),
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null
);
create unique index dispatcher_assignments_active_unique
  on public.dispatcher_assignments (carrier_id, dispatcher_id) where ended_at is null;
create unique index dispatcher_assignments_one_primary
  on public.dispatcher_assignments (carrier_id) where ended_at is null and is_primary;
create index dispatcher_assignments_dispatcher_idx
  on public.dispatcher_assignments (dispatcher_id) where ended_at is null;

create or replace function app.guard_dispatcher_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.carrier_id <> old.carrier_id or new.dispatcher_id <> old.dispatcher_id) then
    raise exception 'assignments cannot be re-targeted; end it and create a new one' using errcode = '22023';
  end if;
  if new.ended_at is null and not exists (
    select 1 from public.user_roles r
    where r.user_id = new.dispatcher_id and r.revoked_at is null and r.role in ('dispatcher', 'admin', 'super_admin')
  ) then
    raise exception 'assignee must hold an active dispatcher or admin role' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.assigned_by := coalesce(new.assigned_by, auth.uid());
  elsif old.ended_at is null and new.ended_at is not null then
    new.ended_by := coalesce(new.ended_by, auth.uid());
  end if;
  return new;
end
$$;
create trigger dispatcher_assignments_guard before insert or update on public.dispatcher_assignments
  for each row execute function app.guard_dispatcher_assignment();
create trigger dispatcher_assignments_audit after insert or update on public.dispatcher_assignments
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- Carrier access helpers
-- -----------------------------------------------------------------------------
create or replace function app.can_staff_access_carrier(p_carrier uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
    or (
      app.is_dispatcher()
      and (
        exists (
          select 1 from public.user_roles r
          where r.user_id = auth.uid() and r.role = 'dispatcher'
            and r.revoked_at is null and r.grants_all_carriers
        )
        or exists (
          select 1 from public.dispatcher_assignments da
          where da.carrier_id = p_carrier and da.dispatcher_id = auth.uid() and da.ended_at is null
        )
      )
    )
$$;

create or replace function app.is_carrier_member(p_carrier uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.carriers c
    join public.organization_members m on m.organization_id = c.organization_id
    where c.id = p_carrier and c.deleted_at is null
      and m.user_id = auth.uid() and m.status = 'active'
  ) and app.email_verified()
$$;

create or replace function app.is_carrier_owner(p_carrier uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.carriers c
    join public.organization_members m on m.organization_id = c.organization_id
    where c.id = p_carrier and c.deleted_at is null
      and m.user_id = auth.uid() and m.status = 'active' and m.role = 'carrier_owner'
  ) and app.email_verified()
$$;

create or replace function app.can_read_carrier(p_carrier uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_staff_access_carrier(p_carrier) or app.is_carrier_member(p_carrier)
$$;

create or replace function app.can_view_profile(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_profile = auth.uid()
    or app.is_admin()
    -- Staff can see other staff (assignee pickers, audit actors).
    or (app.is_dispatcher() and exists (
      select 1 from public.user_roles r where r.user_id = p_profile and r.revoked_at is null
    ))
    -- Dispatchers see users of carriers they can access.
    or (app.is_dispatcher() and exists (
      select 1 from public.organization_members m
      join public.carriers c on c.organization_id = m.organization_id
      where m.user_id = p_profile and app.can_staff_access_carrier(c.id)
    ))
    -- Carrier users see teammates and their assigned dispatchers.
    or exists (
      select 1 from public.organization_members me
      join public.organization_members them on them.organization_id = me.organization_id
      where me.user_id = auth.uid() and me.status = 'active' and them.user_id = p_profile
    )
    or exists (
      select 1 from public.organization_members me
      join public.carriers c on c.organization_id = me.organization_id
      join public.dispatcher_assignments da on da.carrier_id = c.id and da.ended_at is null
      where me.user_id = auth.uid() and me.status = 'active' and da.dispatcher_id = p_profile
    )
$$;

create or replace function app.can_staff_access_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin() or exists (
    select 1 from public.carriers c
    where c.organization_id = p_org and app.can_staff_access_carrier(c.id)
  )
$$;

-- organizations
create policy organizations_select on public.organizations for select to authenticated
  using (app.can_staff_access_org(id) or app.is_org_member(id));
create policy organizations_insert on public.organizations for insert to authenticated
  with check ((select app.is_admin()));
create policy organizations_update on public.organizations for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- organization_members
create policy organization_members_select on public.organization_members for select to authenticated
  using (user_id = (select auth.uid()) or app.can_staff_access_org(organization_id) or app.is_org_member(organization_id));
create policy organization_members_insert on public.organization_members for insert to authenticated
  with check ((select app.is_admin()));
create policy organization_members_update_admin on public.organization_members for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy organization_members_update_owner on public.organization_members for update to authenticated
  using (app.is_org_owner(organization_id) and role = 'carrier_member' and user_id <> (select auth.uid()))
  with check (app.is_org_owner(organization_id) and role = 'carrier_member');

-- organization_invitations: owners manage member invitations; admins manage all.
create policy organization_invitations_select on public.organization_invitations for select to authenticated
  using (app.can_staff_access_org(organization_id) or app.is_org_owner(organization_id));
create policy organization_invitations_insert on public.organization_invitations for insert to authenticated
  with check (
    (select app.is_admin())
    or (app.is_org_owner(organization_id) and role = 'carrier_member' and invited_by = (select auth.uid()))
  );
create policy organization_invitations_update on public.organization_invitations for update to authenticated
  using ((select app.is_admin()) or (app.is_org_owner(organization_id) and role = 'carrier_member'))
  with check ((select app.is_admin()) or (app.is_org_owner(organization_id) and role = 'carrier_member'));

-- Profiles RLS
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated
  using (app.can_view_profile(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_update_admin on public.profiles for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create or replace function app.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_system() or app.is_admin() then
    return new;
  end if;
  if new.email is distinct from old.email or new.deactivated_at is distinct from old.deactivated_at then
    raise exception 'email and account status are managed by administrators' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function app.guard_profile_update();
create trigger profiles_audit after update on public.profiles
  for each row execute function app.audit_row_change('phone');

-- Carrier column guard: which columns each role may change.
create or replace function app.guard_carrier_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  preference_cols text[] := array[
    'min_rate_per_mile', 'desired_weekly_gross', 'days_available', 'max_deadhead_miles',
    'preferences_notes', 'phone', 'email', 'home_base_city', 'home_base_state',
    'factoring_status', 'factoring_company_name', 'updated_at'
  ];
  dispatcher_cols text[] := preference_cols || array[
    'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'noa_on_file',
    'insurance_expiration_date', 'dba_name'
  ];
begin
  if new.organization_id is distinct from old.organization_id or new.application_id is distinct from old.application_id then
    raise exception 'carrier organization and application links are immutable' using errcode = '42501';
  end if;

  if not (app.is_system() or app.is_admin() or app.in_internal('carrier_lifecycle')) then
    if app.can_staff_access_carrier(old.id) then
      if not app.only_columns_changed(to_jsonb(old), to_jsonb(new), dispatcher_cols) then
        raise exception 'dispatchers cannot change carrier identity, status, verification or cancellation fields'
          using errcode = '42501';
      end if;
    elsif app.is_carrier_owner(old.id) then
      if not app.only_columns_changed(to_jsonb(old), to_jsonb(new), preference_cols) then
        raise exception 'carriers may update only operating preferences, contact and factoring details'
          using errcode = '42501';
      end if;
    else
      raise exception 'not permitted' using errcode = '42501';
    end if;
  end if;

  if new.authority_verification_status is distinct from old.authority_verification_status then
    new.authority_verified_at := case when new.authority_verification_status = 'verified' then now() end;
    new.authority_verified_by := case when new.authority_verification_status = 'verified' then auth.uid() end;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'onboarding' and new.status in ('active', 'inactive'))
      or (old.status = 'active' and new.status = 'inactive')
      or (old.status = 'inactive' and new.status in ('active', 'onboarding'))
    ) then
      raise exception 'invalid carrier status transition % -> %', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'active' then
      if not app.carrier_onboarding_complete(new.id) then
        raise exception 'carrier onboarding is incomplete; activation refused' using errcode = '23514',
          hint = 'onboarding_incomplete';
      end if;
      new.activated_at := now();
      new.activated_by := auth.uid();
      new.deactivated_at := null;
    elsif new.status = 'inactive' then
      new.deactivated_at := now();
    end if;
  end if;
  return new;
end
$$;
create trigger carriers_guard before update on public.carriers
  for each row execute function app.guard_carrier_update();
create trigger carriers_audit after insert or update on public.carriers
  for each row execute function app.audit_row_change('ein_last4');

-- Keep application status in step with the carrier lifecycle.
create or replace function app.sync_application_with_carrier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.application_id is not null and new.status is distinct from old.status then
    update public.carrier_applications a
    set status = case new.status
        when 'active' then 'active'::public.application_status
        when 'inactive' then 'inactive'::public.application_status
        else 'onboarding'::public.application_status
      end
    where a.id = new.application_id
      and a.status is distinct from (case new.status
        when 'active' then 'active'::public.application_status
        when 'inactive' then 'inactive'::public.application_status
        else 'onboarding'::public.application_status end);
  end if;
  return null;
end
$$;
create trigger carriers_sync_application after update of status on public.carriers
  for each row execute function app.sync_application_with_carrier();

-- Generic guard: rows can never move between carriers.
create or replace function app.guard_carrier_id_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.carrier_id is distinct from old.carrier_id then
    raise exception '% records cannot be moved to a different carrier', tg_table_name
      using errcode = '42501', hint = 'carrier_reassignment_forbidden';
  end if;
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- Fleet
-- -----------------------------------------------------------------------------
create table public.trucks (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers (id),
  unit_number text not null check (char_length(unit_number) between 1 and 40),
  equipment_type text not null references public.equipment_types (key),
  year smallint check (year between 1980 and 2100),
  make text check (char_length(make) <= 60),
  model text check (char_length(model) <= 60),
  vin text check (vin ~ '^[A-HJ-NPR-Z0-9]{11,17}$'),
  license_plate text check (char_length(license_plate) <= 20),
  plate_state char(2),
  vehicle_capacity smallint check (vehicle_capacity between 0 and 20),
  max_payload_lbs numeric(10, 2) check (max_payload_lbs >= 0),
  status text not null default 'active' check (status in ('active', 'inactive', 'out_of_service')),
  notes text check (char_length(notes) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (carrier_id, unit_number),
  unique (id, carrier_id)
);
create index trucks_carrier_idx on public.trucks (carrier_id);
create trigger trucks_touch before update on public.trucks for each row execute function app.touch_updated_at();
create trigger trucks_carrier_guard before update on public.trucks for each row execute function app.guard_carrier_id_immutable();
create trigger trucks_audit after insert or update on public.trucks for each row execute function app.audit_row_change();

create table public.trailers (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers (id),
  truck_id uuid,
  trailer_type text not null check (trailer_type in (
    'open_car_hauler', 'enclosed_car_hauler', 'wedge', 'gooseneck', 'flatbed', 'dry_van', 'box', 'other'
  )),
  length_ft numeric(5, 1) check (length_ft > 0 and length_ft < 100),
  vehicle_capacity smallint check (vehicle_capacity between 0 and 20),
  max_payload_lbs numeric(10, 2) check (max_payload_lbs >= 0),
  vin text check (vin ~ '^[A-HJ-NPR-Z0-9]{11,17}$'),
  license_plate text check (char_length(license_plate) <= 20),
  status text not null default 'active' check (status in ('active', 'inactive', 'out_of_service')),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, carrier_id),
  foreign key (truck_id, carrier_id) references public.trucks (id, carrier_id)
);
create index trailers_carrier_idx on public.trailers (carrier_id);
create trigger trailers_touch before update on public.trailers for each row execute function app.touch_updated_at();
create trigger trailers_carrier_guard before update on public.trailers for each row execute function app.guard_carrier_id_immutable();

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers (id),
  user_id uuid references public.profiles (id) on delete set null,
  full_name text not null check (char_length(full_name) between 1 and 200),
  email extensions.citext check (char_length(email) <= 254),
  phone text check (char_length(phone) <= 40),
  license_state char(2),
  license_expiration date,
  medical_card_expiration date,
  is_owner_operator boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, carrier_id)
);
create index drivers_carrier_idx on public.drivers (carrier_id);
create trigger drivers_touch before update on public.drivers for each row execute function app.touch_updated_at();
create trigger drivers_carrier_guard before update on public.drivers for each row execute function app.guard_carrier_id_immutable();
create trigger drivers_audit after insert or update on public.drivers for each row execute function app.audit_row_change('phone,email');

create table public.driver_availability (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers (id),
  driver_id uuid not null,
  truck_id uuid,
  status text not null default 'available' check (status in ('available', 'unavailable', 'home_time')),
  available_from timestamptz not null,
  available_until timestamptz,
  location_city text check (char_length(location_city) <= 100),
  location_state char(2),
  notes text check (char_length(notes) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_availability_window check (available_until is null or available_until > available_from),
  foreign key (driver_id, carrier_id) references public.drivers (id, carrier_id),
  foreign key (truck_id, carrier_id) references public.trucks (id, carrier_id)
);
create index driver_availability_carrier_idx on public.driver_availability (carrier_id, available_from desc);
create index driver_availability_window_idx on public.driver_availability (available_from, available_until);
create trigger driver_availability_touch before update on public.driver_availability for each row execute function app.touch_updated_at();
create trigger driver_availability_carrier_guard before update on public.driver_availability for each row execute function app.guard_carrier_id_immutable();

create table public.lane_preferences (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers (id),
  preference text not null check (preference in ('preferred', 'avoid')),
  origin_state char(2),
  destination_state char(2),
  min_rate_per_mile numeric(8, 2) check (min_rate_per_mile >= 0 and min_rate_per_mile < 100),
  notes text check (char_length(notes) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lane_preferences_has_state check (origin_state is not null or destination_state is not null)
);
create index lane_preferences_carrier_idx on public.lane_preferences (carrier_id);
create trigger lane_preferences_touch before update on public.lane_preferences for each row execute function app.touch_updated_at();
create trigger lane_preferences_carrier_guard before update on public.lane_preferences for each row execute function app.guard_carrier_id_immutable();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.equipment_types enable row level security;
alter table public.carrier_applications enable row level security;
alter table public.carriers enable row level security;
alter table public.dispatcher_assignments enable row level security;
alter table public.trucks enable row level security;
alter table public.trailers enable row level security;
alter table public.drivers enable row level security;
alter table public.driver_availability enable row level security;
alter table public.lane_preferences enable row level security;

-- equipment_types: public reference data
create policy equipment_types_select on public.equipment_types for select to anon, authenticated using (true);
create policy equipment_types_insert on public.equipment_types for insert to authenticated with check ((select app.is_admin()));
create policy equipment_types_update on public.equipment_types for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
grant select on public.equipment_types to anon;

-- carrier_applications: staff pipeline; approved carriers can read their own.
create policy carrier_applications_select on public.carrier_applications for select to authenticated
  using ((select app.is_staff()) or (carrier_id is not null and app.is_carrier_member(carrier_id)));
create policy carrier_applications_update on public.carrier_applications for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- carriers
create policy carriers_select on public.carriers for select to authenticated
  using (app.can_read_carrier(id));
create policy carriers_insert on public.carriers for insert to authenticated
  with check ((select app.is_admin()));
create policy carriers_update on public.carriers for update to authenticated
  using (app.can_staff_access_carrier(id) or app.is_carrier_owner(id))
  with check (app.can_staff_access_carrier(id) or app.is_carrier_owner(id));

-- dispatcher_assignments
create policy dispatcher_assignments_select on public.dispatcher_assignments for select to authenticated
  using (app.can_read_carrier(carrier_id));
create policy dispatcher_assignments_insert on public.dispatcher_assignments for insert to authenticated
  with check ((select app.is_admin()));
create policy dispatcher_assignments_update on public.dispatcher_assignments for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- fleet tables: staff with access and carrier owners manage; any member reads.
create policy trucks_select on public.trucks for select to authenticated using (app.can_read_carrier(carrier_id));
create policy trucks_insert on public.trucks for insert to authenticated
  with check (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id));
create policy trucks_update on public.trucks for update to authenticated
  using (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id))
  with check (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id));

create policy trailers_select on public.trailers for select to authenticated using (app.can_read_carrier(carrier_id));
create policy trailers_insert on public.trailers for insert to authenticated
  with check (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id));
create policy trailers_update on public.trailers for update to authenticated
  using (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id))
  with check (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id));

create policy drivers_select on public.drivers for select to authenticated using (app.can_read_carrier(carrier_id));
create policy drivers_insert on public.drivers for insert to authenticated
  with check (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id));
create policy drivers_update on public.drivers for update to authenticated
  using (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id))
  with check (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id));

-- availability: any active member may maintain it (drivers update their own availability).
create policy driver_availability_select on public.driver_availability for select to authenticated
  using (app.can_read_carrier(carrier_id));
create policy driver_availability_insert on public.driver_availability for insert to authenticated
  with check (app.can_read_carrier(carrier_id));
create policy driver_availability_update on public.driver_availability for update to authenticated
  using (app.can_read_carrier(carrier_id)) with check (app.can_read_carrier(carrier_id));
create policy driver_availability_delete on public.driver_availability for delete to authenticated
  using (app.can_read_carrier(carrier_id));

create policy lane_preferences_select on public.lane_preferences for select to authenticated
  using (app.can_read_carrier(carrier_id));
create policy lane_preferences_insert on public.lane_preferences for insert to authenticated
  with check (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id));
create policy lane_preferences_update on public.lane_preferences for update to authenticated
  using (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id))
  with check (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id));
create policy lane_preferences_delete on public.lane_preferences for delete to authenticated
  using (app.can_staff_access_carrier(carrier_id) or app.is_carrier_owner(carrier_id));
