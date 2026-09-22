-- =============================================================================
-- Loads and the dispatch workflow.
--
-- Compliance invariants enforced here (see docs/COMPLIANCE_INVARIANTS.md):
--   * Every load belongs to exactly one contracted carrier from creation
--     (carrier_id NOT NULL, contracted check). There is no unassigned pool.
--   * carrier_id can never change. A load removed from a carrier is cancelled
--     and returned to the broker.
--   * A load cannot be booked without an assigned truck and driver, rate
--     information, and a carrier approval that matches the current rate.
--   * Carrier approval is recorded with timestamp and approving person.
--   * Completed and cancelled loads are immutable.
-- =============================================================================

create table public.brokers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  mc_number text check (char_length(mc_number) <= 20),
  usdot_number text check (char_length(usdot_number) <= 20),
  phone text check (char_length(phone) <= 40),
  email extensions.citext check (char_length(email) <= 254),
  city text check (char_length(city) <= 100),
  state char(2),
  credit_notes text check (char_length(credit_notes) <= 4000),
  payment_terms text check (char_length(payment_terms) <= 200),
  do_not_use boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index brokers_mc_unique on public.brokers (mc_number) where mc_number is not null;
create index brokers_name_idx on public.brokers (lower(name));
create trigger brokers_touch before update on public.brokers for each row execute function app.touch_updated_at();
create trigger brokers_audit after insert or update on public.brokers for each row execute function app.audit_row_change();

create sequence public.load_reference_seq;

create or replace function app.next_load_reference()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'LD-' || to_char(now() at time zone 'UTC', 'YYMM') || '-' || lpad(nextval('public.load_reference_seq')::text, 5, '0')
$$;

create table public.loads (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default app.next_load_reference(),
  carrier_id uuid not null references public.carriers (id),
  truck_id uuid,
  trailer_id uuid,
  driver_id uuid,
  dispatcher_id uuid references public.profiles (id),
  status public.load_status not null default 'opportunity',
  status_note text check (char_length(status_note) <= 1000),
  -- Broker (the carrier's customer; never a party paying the dispatch company)
  broker_id uuid references public.brokers (id),
  broker_name text not null check (char_length(broker_name) between 1 and 200),
  broker_mc_number text check (char_length(broker_mc_number) <= 20),
  broker_contact_name text check (char_length(broker_contact_name) <= 200),
  broker_contact_phone text check (char_length(broker_contact_phone) <= 40),
  broker_contact_email extensions.citext check (char_length(broker_contact_email) <= 254),
  broker_load_number text check (char_length(broker_load_number) <= 60),
  -- Freight
  equipment_type text references public.equipment_types (key),
  commodity text check (char_length(commodity) <= 200),
  weight_lbs numeric(10, 2) check (weight_lbs >= 0),
  -- Rate and mileage
  gross_rate numeric(12, 2) check (gross_rate >= 0),
  loaded_miles numeric(10, 1) check (loaded_miles >= 0),
  deadhead_miles numeric(10, 1) not null default 0 check (deadhead_miles >= 0),
  total_miles numeric(10, 1) generated always as (coalesce(loaded_miles, 0) + deadhead_miles) stored,
  loaded_rate_per_mile numeric(10, 4) generated always as (
    case when loaded_miles > 0 then round(gross_rate / loaded_miles, 4) end
  ) stored,
  all_in_rate_per_mile numeric(10, 4) generated always as (
    case when coalesce(loaded_miles, 0) + deadhead_miles > 0
      then round(gross_rate / (coalesce(loaded_miles, 0) + deadhead_miles), 4) end
  ) stored,
  -- Additional charges (maintained from load_charges)
  detention_total numeric(12, 2) not null default 0,
  layover_total numeric(12, 2) not null default 0,
  tonu_total numeric(12, 2) not null default 0,
  other_charges_total numeric(12, 2) not null default 0,
  lumper_reimbursement_total numeric(12, 2) not null default 0,
  -- Fee estimate from the contract in force (final amounts live in fee_snapshots)
  fee_contract_id uuid references public.carrier_fee_contracts (id),
  fee_model public.fee_model,
  fee_percentage numeric(6, 4),
  flat_weekly_amount numeric(12, 2),
  eligible_revenue numeric(12, 2),
  estimated_dispatch_fee numeric(12, 2),
  carrier_estimated_net numeric(12, 2),
  required_documents public.document_type[] not null
    default '{rate_confirmation,bill_of_lading,proof_of_delivery}',
  -- Lifecycle timestamps
  proposed_at timestamptz,
  booked_at timestamptz,
  booked_by uuid references public.profiles (id) on delete set null,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancellation_reason text check (char_length(cancellation_reason) <= 1000),
  cancellation_disposition text check (cancellation_disposition in ('returned_to_broker', 'broker_cancelled')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, carrier_id),
  foreign key (truck_id, carrier_id) references public.trucks (id, carrier_id),
  foreign key (trailer_id, carrier_id) references public.trailers (id, carrier_id),
  foreign key (driver_id, carrier_id) references public.drivers (id, carrier_id),
  constraint loads_cancel_reason check (status <> 'cancelled' or cancellation_reason is not null)
);
create index loads_carrier_status_idx on public.loads (carrier_id, status);
create index loads_status_idx on public.loads (status, updated_at desc);
create index loads_dispatcher_idx on public.loads (dispatcher_id);
create index loads_booked_idx on public.loads (booked_at) where booked_at is not null;
create index loads_completed_idx on public.loads (completed_at) where completed_at is not null;
create trigger loads_touch before update on public.loads for each row execute function app.touch_updated_at();

alter table public.documents
  add constraint documents_load_fk foreign key (load_id, carrier_id) references public.loads (id, carrier_id);

create table public.load_stops (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null,
  carrier_id uuid not null,
  sequence smallint not null check (sequence between 1 and 50),
  stop_type text not null check (stop_type in ('pickup', 'delivery')),
  facility_name text check (char_length(facility_name) <= 200),
  address_line1 text check (char_length(address_line1) <= 200),
  city text not null check (char_length(city) between 1 and 100),
  state char(2) not null,
  postal_code text check (char_length(postal_code) <= 10),
  appointment_type text not null default 'window' check (appointment_type in ('appointment', 'window', 'fcfs')),
  window_start timestamptz,
  window_end timestamptz,
  contact_name text check (char_length(contact_name) <= 200),
  contact_phone text check (char_length(contact_phone) <= 40),
  instructions text check (char_length(instructions) <= 2000),
  arrived_at timestamptz,
  departed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (load_id, sequence),
  unique (id, load_id),
  foreign key (load_id, carrier_id) references public.loads (id, carrier_id),
  constraint load_stops_window check (window_end is null or window_start is null or window_end >= window_start)
);
create index load_stops_load_idx on public.load_stops (load_id, sequence);
create trigger load_stops_touch before update on public.load_stops for each row execute function app.touch_updated_at();

create table public.load_vehicles (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null,
  carrier_id uuid not null,
  pickup_stop_id uuid,
  delivery_stop_id uuid,
  vin text check (vin ~ '^[A-HJ-NPR-Z0-9]{11,17}$'),
  year smallint check (year between 1900 and 2100),
  make text check (char_length(make) <= 60),
  model text check (char_length(model) <= 60),
  vehicle_type text not null default 'other'
    check (vehicle_type in ('sedan', 'coupe', 'suv', 'pickup', 'van', 'motorcycle', 'heavy_equipment', 'other')),
  operable boolean not null default true,
  auction_or_dealer_name text check (char_length(auction_or_dealer_name) <= 200),
  lot_number text check (char_length(lot_number) <= 60),
  pickup_contact_name text check (char_length(pickup_contact_name) <= 200),
  pickup_contact_phone text check (char_length(pickup_contact_phone) <= 40),
  delivery_contact_name text check (char_length(delivery_contact_name) <= 200),
  delivery_contact_phone text check (char_length(delivery_contact_phone) <= 40),
  keys_title_notes text check (char_length(keys_title_notes) <= 1000),
  payment_amount numeric(12, 2) check (payment_amount >= 0),
  inspection_status text not null default 'pending'
    check (inspection_status in ('pending', 'pickup_inspected', 'delivery_inspected', 'damage_noted')),
  document_status text not null default 'pending' check (document_status in ('pending', 'received', 'verified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (load_id, carrier_id) references public.loads (id, carrier_id),
  foreign key (pickup_stop_id, load_id) references public.load_stops (id, load_id),
  foreign key (delivery_stop_id, load_id) references public.load_stops (id, load_id)
);
create index load_vehicles_load_idx on public.load_vehicles (load_id);
create trigger load_vehicles_touch before update on public.load_vehicles for each row execute function app.touch_updated_at();

create table public.load_charges (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null,
  carrier_id uuid not null,
  charge_type public.charge_type not null,
  amount numeric(12, 2) not null check (amount > 0),
  description text check (char_length(description) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (load_id, carrier_id) references public.loads (id, carrier_id)
);
create index load_charges_load_idx on public.load_charges (load_id);
create trigger load_charges_touch before update on public.load_charges for each row execute function app.touch_updated_at();

create table public.load_notes (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null,
  carrier_id uuid not null,
  visibility text not null check (visibility in ('internal', 'carrier')),
  kind text not null default 'note' check (kind in ('note', 'broker_credit')),
  body text not null check (char_length(body) between 1 and 5000),
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (load_id, carrier_id) references public.loads (id, carrier_id),
  constraint load_notes_broker_credit_internal check (kind <> 'broker_credit' or visibility = 'internal')
);
create index load_notes_load_idx on public.load_notes (load_id, created_at);

create table public.load_status_history (
  id bigint generated always as identity primary key,
  load_id uuid not null,
  carrier_id uuid not null,
  from_status public.load_status,
  to_status public.load_status not null,
  note text,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  foreign key (load_id, carrier_id) references public.loads (id, carrier_id)
);
create index load_status_history_load_idx on public.load_status_history (load_id, changed_at);

create table public.load_approvals (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null,
  carrier_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected')),
  method text not null check (method in ('portal', 'phone', 'email', 'text_message')),
  decided_by uuid references public.profiles (id) on delete set null,
  approver_name text not null check (char_length(approver_name) between 2 and 200),
  recorded_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default clock_timestamp(),
  approved_gross_rate numeric(12, 2) not null check (approved_gross_rate >= 0),
  note text check (char_length(note) <= 2000),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (load_id, carrier_id) references public.loads (id, carrier_id),
  constraint load_approvals_portal_actor check (method <> 'portal' or (decided_by is not null and recorded_by is null)),
  constraint load_approvals_recorded_evidence check (
    method = 'portal' or (recorded_by is not null and note is not null and char_length(note) >= 10)
  )
);
create index load_approvals_load_idx on public.load_approvals (load_id, decided_at desc);

-- -----------------------------------------------------------------------------
-- Workflow helpers
-- -----------------------------------------------------------------------------

-- A carrier is "contracted" when it is active, has accepted the dispatch
-- service agreement (not revoked or terminated) and has a fee contract in force.
create or replace function app.carrier_is_contracted(p_carrier uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.carriers c
    where c.id = p_carrier and c.status = 'active' and c.deleted_at is null
  )
  and exists (
    select 1
    from public.agreement_acceptances aa
    join public.agreement_versions av on av.id = aa.agreement_version_id
    join public.agreements a on a.id = av.agreement_id
    where aa.carrier_id = p_carrier and a.key = 'dispatch_service_agreement'
      and aa.revoked_at is null and aa.terminated_at is null
  )
  and (app.fee_contract_on(p_carrier, app.business_today())).id is not null
$$;

create or replace function app.load_has_valid_approval(p_load uuid, p_gross numeric)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Each new decision supersedes earlier ones, so at most one decision is live.
  select exists (
    select 1 from public.load_approvals la
    where la.load_id = p_load and la.decision = 'approved'
      and la.superseded_at is null and la.approved_gross_rate = p_gross
  )
$$;

create or replace function app.load_transition_allowed(p_from public.load_status, p_to public.load_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'opportunity' then p_to in ('proposed', 'cancelled')
    when 'proposed' then p_to in ('approved', 'opportunity', 'cancelled')
    when 'approved' then p_to in ('booked', 'proposed', 'opportunity', 'cancelled')
    when 'booked' then p_to in ('dispatched', 'cancelled')
    when 'dispatched' then p_to in ('at_pickup', 'cancelled')
    when 'at_pickup' then p_to in ('loaded', 'cancelled')
    when 'loaded' then p_to = 'in_transit'
    when 'in_transit' then p_to = 'delivered'
    when 'delivered' then p_to in ('paperwork_pending', 'completed')
    when 'paperwork_pending' then p_to = 'completed'
    else false
  end
$$;

create or replace function app.supersede_load_approvals(p_load uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.load_approvals set superseded_at = now()
  where load_id = p_load and superseded_at is null
$$;

-- Recalculate charge totals and the fee estimate on every write to an open load.
create or replace function app.compute_load_estimate(l public.loads)
returns public.loads
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.carrier_fee_contracts;
  revenue_extra numeric(12, 2);
begin
  select
    coalesce(sum(amount) filter (where charge_type = 'detention'), 0),
    coalesce(sum(amount) filter (where charge_type = 'layover'), 0),
    coalesce(sum(amount) filter (where charge_type = 'tonu'), 0),
    coalesce(sum(amount) filter (where charge_type = 'other'), 0),
    coalesce(sum(amount) filter (where charge_type = 'lumper_reimbursement'), 0)
  into l.detention_total, l.layover_total, l.tonu_total, l.other_charges_total, l.lumper_reimbursement_total
  from public.load_charges ch
  where ch.load_id = l.id;

  c := app.fee_contract_on(l.carrier_id, app.business_today());
  revenue_extra := l.detention_total + l.layover_total + l.tonu_total + l.other_charges_total;

  if c.id is null then
    l.fee_contract_id := null;
    l.fee_model := null;
    l.fee_percentage := null;
    l.flat_weekly_amount := null;
    l.eligible_revenue := null;
    l.estimated_dispatch_fee := null;
    l.carrier_estimated_net := null;
    return l;
  end if;

  l.fee_contract_id := c.id;
  l.fee_model := c.model;
  l.fee_percentage := c.percentage;
  l.flat_weekly_amount := c.flat_weekly_amount;
  l.eligible_revenue := coalesce(l.gross_rate, 0)
    + case when c.include_detention then l.detention_total else 0 end
    + case when c.include_layover then l.layover_total else 0 end
    + case when c.include_tonu then l.tonu_total else 0 end
    + case when c.include_other then l.other_charges_total else 0 end;
  l.estimated_dispatch_fee := case
    when c.model = 'percentage' then round(l.eligible_revenue * c.percentage, 2)
    else 0 -- flat weekly plans are billed per active truck on the weekly statement
  end;
  -- Before operating expenses (fuel, insurance, maintenance, etc.). Lumper
  -- reimbursements are pass-through and excluded.
  l.carrier_estimated_net := coalesce(l.gross_rate, 0) + revenue_extra - l.estimated_dispatch_fee;
  return l;
end
$$;

create or replace function app.guard_load_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pickups integer;
  deliveries integer;
  missing public.document_type[];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'opportunity' then
      raise exception 'loads start as opportunities' using errcode = '23514', hint = 'invalid_initial_status';
    end if;
    if not app.carrier_is_contracted(new.carrier_id) then
      raise exception 'freight can only be worked for an active, contracted carrier'
        using errcode = '23514', hint = 'carrier_not_contracted';
    end if;
    if not app.is_system() then
      new.created_by := auth.uid();
      new.dispatcher_id := coalesce(new.dispatcher_id, auth.uid());
    end if;
    new := app.compute_load_estimate(new);
    return new;
  end if;

  -- UPDATE ---------------------------------------------------------------
  if new.carrier_id is distinct from old.carrier_id then
    raise exception 'a load cannot be reassigned to a different carrier; cancel it and return it to the broker'
      using errcode = '42501', hint = 'load_reassignment_forbidden';
  end if;
  if old.status in ('completed', 'cancelled') then
    raise exception 'completed and cancelled loads are closed records' using errcode = '42501',
      hint = 'immutable_record';
  end if;
  if new.reference is distinct from old.reference or new.created_by is distinct from old.created_by then
    raise exception 'load reference and creator are immutable' using errcode = '42501';
  end if;

  -- A rate change after carrier approval sends the load back for re-approval.
  if old.status = 'approved' and new.status = 'approved' and new.gross_rate is distinct from old.gross_rate then
    new.status := 'proposed';
    new.status_note := coalesce(new.status_note, 'Rate changed after approval; carrier approval required again');
  end if;

  if new.dispatcher_id is distinct from old.dispatcher_id and new.dispatcher_id is not null and not exists (
    select 1 from public.user_roles r where r.user_id = new.dispatcher_id and r.revoked_at is null
  ) then
    raise exception 'dispatcher must be an active staff member' using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if not app.load_transition_allowed(old.status, new.status) then
      raise exception 'invalid load status transition % -> %', old.status, new.status
        using errcode = '23514', hint = 'invalid_transition';
    end if;

    if new.status in ('opportunity', 'proposed') and old.status = 'approved' then
      perform app.supersede_load_approvals(new.id);
    end if;

    if new.status in ('proposed', 'approved', 'booked') then
      select count(*) filter (where stop_type = 'pickup'), count(*) filter (where stop_type = 'delivery')
      into pickups, deliveries
      from public.load_stops s where s.load_id = new.id;
      if pickups = 0 or deliveries = 0 then
        raise exception 'a load needs at least one pickup and one delivery stop' using errcode = '23514',
          hint = 'stops_required';
      end if;
      if coalesce(new.gross_rate, 0) <= 0 then
        raise exception 'rate information is required' using errcode = '23514', hint = 'rate_required';
      end if;
      if not app.carrier_is_contracted(new.carrier_id) then
        raise exception 'carrier is not active and contracted' using errcode = '23514', hint = 'carrier_not_contracted';
      end if;
    end if;

    case new.status
      when 'proposed' then
        new.proposed_at := now();
      when 'approved' then
        if not app.load_has_valid_approval(new.id, new.gross_rate) then
          raise exception 'carrier approval for the current rate is required' using errcode = '23514',
            hint = 'carrier_approval_required';
        end if;
      when 'booked' then
        if new.truck_id is null or new.driver_id is null then
          raise exception 'a specific truck and driver must be assigned before booking' using errcode = '23514',
            hint = 'truck_and_driver_required';
        end if;
        if not exists (select 1 from public.trucks t where t.id = new.truck_id and t.status = 'active') then
          raise exception 'assigned truck is not active' using errcode = '23514', hint = 'truck_inactive';
        end if;
        if not exists (select 1 from public.drivers d where d.id = new.driver_id and d.status = 'active') then
          raise exception 'assigned driver is not active' using errcode = '23514', hint = 'driver_inactive';
        end if;
        if coalesce(new.loaded_miles, 0) <= 0 then
          raise exception 'loaded miles are required before booking' using errcode = '23514', hint = 'rate_required';
        end if;
        if not app.load_has_valid_approval(new.id, new.gross_rate) then
          raise exception 'carrier approval for the current rate is required before booking'
            using errcode = '23514', hint = 'carrier_approval_required';
        end if;
        new.booked_at := now();
        new.booked_by := auth.uid();
      when 'dispatched' then
        new.dispatched_at := now();
      when 'delivered' then
        new.delivered_at := now();
      when 'completed' then
        select coalesce(array_agg(rd), '{}') into missing
        from unnest(new.required_documents) rd
        where not exists (
          select 1 from public.documents d
          where d.load_id = new.id and d.doc_type = rd and d.deleted_at is null
            and d.status in ('pending_review', 'accepted')
        );
        if cardinality(missing) > 0 then
          raise exception 'required load documents are missing: %', array_to_string(missing, ', ')
            using errcode = '23514', hint = 'documents_required';
        end if;
        new.completed_at := now();
      when 'cancelled' then
        if new.cancellation_reason is null or char_length(trim(new.cancellation_reason)) < 3 then
          raise exception 'a cancellation reason is required' using errcode = '23514', hint = 'reason_required';
        end if;
        new.cancellation_disposition := coalesce(new.cancellation_disposition, 'returned_to_broker');
        new.cancelled_at := now();
        new.cancelled_by := auth.uid();
        perform app.supersede_load_approvals(new.id);
      else
        null;
    end case;
  end if;

  new := app.compute_load_estimate(new);
  return new;
end
$$;
create trigger loads_guard before insert or update on public.loads
  for each row execute function app.guard_load_write();

create or replace function app.record_load_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.load_status_history (load_id, carrier_id, from_status, to_status, note, changed_by)
    values (new.id, new.carrier_id, case when tg_op = 'UPDATE' then old.status end, new.status,
            new.status_note, auth.uid());
  end if;
  return null;
end
$$;
create trigger loads_status_history after insert or update on public.loads
  for each row execute function app.record_load_status_history();
create trigger loads_audit after insert or update on public.loads
  for each row execute function app.audit_row_change();

create trigger load_status_history_immutable before update or delete on public.load_status_history
  for each row execute function app.prevent_mutation();
create trigger load_notes_immutable before update or delete on public.load_notes
  for each row execute function app.prevent_mutation();
create trigger load_approvals_no_delete before delete on public.load_approvals
  for each row execute function app.prevent_mutation();

create or replace function app.guard_load_approval_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.only_columns_changed(to_jsonb(old), to_jsonb(new), array['superseded_at']) then
    raise exception 'load approvals are immutable' using errcode = '42501', hint = 'immutable_record';
  end if;
  return new;
end
$$;
create trigger load_approvals_guard before update on public.load_approvals
  for each row execute function app.guard_load_approval_update();

create or replace function app.supersede_previous_decisions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.supersede_load_approvals(new.load_id);
  return new;
end
$$;
create trigger load_approvals_supersede before insert on public.load_approvals
  for each row execute function app.supersede_previous_decisions();

-- Child records of closed loads are locked; charge changes refresh the estimate.
create or replace function app.guard_load_child_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_load uuid := coalesce(new.load_id, old.load_id);
  load_status public.load_status;
begin
  select l.status into load_status from public.loads l where l.id = target_load;
  if load_status in ('completed', 'cancelled') then
    raise exception 'load % is closed; its details can no longer change', target_load
      using errcode = '42501', hint = 'immutable_record';
  end if;
  if tg_op = 'UPDATE' and (new.load_id is distinct from old.load_id or new.carrier_id is distinct from old.carrier_id) then
    raise exception 'load details cannot be moved to another load' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create or replace function app.refresh_load_after_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.loads set updated_at = now() where id = coalesce(new.load_id, old.load_id);
  return null;
end
$$;

create trigger load_stops_guard before insert or update or delete on public.load_stops
  for each row execute function app.guard_load_child_write();
create trigger load_vehicles_guard before insert or update or delete on public.load_vehicles
  for each row execute function app.guard_load_child_write();
create trigger load_charges_guard before insert or update or delete on public.load_charges
  for each row execute function app.guard_load_child_write();
create trigger load_charges_refresh after insert or update or delete on public.load_charges
  for each row execute function app.refresh_load_after_charge();
create trigger load_charges_audit after insert or update or delete on public.load_charges
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- Carrier decisions on proposed loads
-- -----------------------------------------------------------------------------
create or replace function public.respond_to_proposed_load(p_load_id uuid, p_decision text, p_note text default null)
returns public.load_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.loads;
  signer text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected' using errcode = '22023';
  end if;
  select * into l from public.loads where id = p_load_id for update;
  if not found or not app.is_carrier_owner(l.carrier_id) then
    raise exception 'load not found' using errcode = 'P0002';
  end if;
  if l.status <> 'proposed' then
    raise exception 'only proposed loads can be approved or rejected' using errcode = '23514', hint = 'invalid_transition';
  end if;
  if p_decision = 'rejected' and (p_note is null or char_length(trim(p_note)) < 3) then
    raise exception 'please include a short reason when rejecting a load' using errcode = '22023', hint = 'reason_required';
  end if;

  select coalesce(nullif(p.full_name, ''), p.email::text) into signer from public.profiles p where p.id = auth.uid();

  insert into public.load_approvals (load_id, carrier_id, decision, method, decided_by, approver_name, approved_gross_rate, note)
  values (l.id, l.carrier_id, p_decision, 'portal', auth.uid(), signer, l.gross_rate, nullif(trim(p_note), ''));

  if nullif(trim(p_note), '') is not null then
    insert into public.load_notes (load_id, carrier_id, visibility, body, author_id)
    values (l.id, l.carrier_id, 'carrier', trim(p_note), auth.uid());
  end if;

  update public.loads
  set status = case when p_decision = 'approved' then 'approved'::public.load_status else 'opportunity'::public.load_status end,
      status_note = case when p_decision = 'approved' then 'Approved by carrier in portal' else 'Rejected by carrier in portal' end
  where id = l.id;

  return case when p_decision = 'approved' then 'approved'::public.load_status else 'opportunity'::public.load_status end;
end
$$;

-- Staff record an approval or rejection received outside the portal. The note
-- must describe the evidence (who approved, how and when).
create or replace function public.record_carrier_load_decision(
  p_load_id uuid,
  p_decision text,
  p_method text,
  p_approver_name text,
  p_note text,
  p_approver_user_id uuid default null
)
returns public.load_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.loads;
begin
  if p_decision not in ('approved', 'rejected') or p_method not in ('phone', 'email', 'text_message') then
    raise exception 'invalid decision or method' using errcode = '22023';
  end if;
  select * into l from public.loads where id = p_load_id for update;
  if not found or not app.can_staff_access_carrier(l.carrier_id) then
    raise exception 'load not found' using errcode = 'P0002';
  end if;
  if l.status <> 'proposed' then
    raise exception 'only proposed loads can be approved or rejected' using errcode = '23514', hint = 'invalid_transition';
  end if;
  if p_approver_user_id is not null and not exists (
    select 1 from public.carriers c
    join public.organization_members m on m.organization_id = c.organization_id
    where c.id = l.carrier_id and m.user_id = p_approver_user_id and m.status = 'active'
  ) then
    raise exception 'approver is not a member of this carrier' using errcode = '23514';
  end if;

  insert into public.load_approvals (
    load_id, carrier_id, decision, method, decided_by, approver_name, recorded_by, approved_gross_rate, note
  ) values (
    l.id, l.carrier_id, p_decision, p_method, p_approver_user_id, trim(p_approver_name), auth.uid(), l.gross_rate, trim(p_note)
  );

  update public.loads
  set status = case when p_decision = 'approved' then 'approved'::public.load_status else 'opportunity'::public.load_status end,
      status_note = format('Carrier %s by %s (%s), recorded by staff', p_decision, trim(p_approver_name), p_method)
  where id = l.id;

  return case when p_decision = 'approved' then 'approved'::public.load_status else 'opportunity'::public.load_status end;
end
$$;

revoke execute on function public.respond_to_proposed_load(uuid, text, text) from anon, public;
revoke execute on function public.record_carrier_load_decision(uuid, text, text, text, text, uuid) from anon, public;
grant execute on function public.respond_to_proposed_load(uuid, text, text) to authenticated;
grant execute on function public.record_carrier_load_decision(uuid, text, text, text, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.brokers enable row level security;
alter table public.loads enable row level security;
alter table public.load_stops enable row level security;
alter table public.load_vehicles enable row level security;
alter table public.load_charges enable row level security;
alter table public.load_notes enable row level security;
alter table public.load_status_history enable row level security;
alter table public.load_approvals enable row level security;

create policy brokers_select on public.brokers for select to authenticated using ((select app.is_staff()));
create policy brokers_insert on public.brokers for insert to authenticated with check ((select app.is_staff()));
create policy brokers_update on public.brokers for update to authenticated
  using ((select app.is_staff())) with check ((select app.is_staff()));

-- Carriers see their loads once proposed; opportunities are dispatcher work in progress.
create or replace function app.carrier_can_see_load(p_load uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.loads l
    where l.id = p_load and l.status <> 'opportunity' and app.is_carrier_member(l.carrier_id)
  )
$$;

create policy loads_select on public.loads for select to authenticated
  using (app.can_staff_access_carrier(carrier_id) or (status <> 'opportunity' and app.is_carrier_member(carrier_id)));
create policy loads_insert on public.loads for insert to authenticated
  with check (app.can_staff_access_carrier(carrier_id));
create policy loads_update on public.loads for update to authenticated
  using (app.can_staff_access_carrier(carrier_id)) with check (app.can_staff_access_carrier(carrier_id));

create policy load_stops_select on public.load_stops for select to authenticated
  using (app.can_staff_access_carrier(carrier_id) or app.carrier_can_see_load(load_id));
create policy load_stops_write on public.load_stops for all to authenticated
  using (app.can_staff_access_carrier(carrier_id)) with check (app.can_staff_access_carrier(carrier_id));

create policy load_vehicles_select on public.load_vehicles for select to authenticated
  using (app.can_staff_access_carrier(carrier_id) or app.carrier_can_see_load(load_id));
create policy load_vehicles_write on public.load_vehicles for all to authenticated
  using (app.can_staff_access_carrier(carrier_id)) with check (app.can_staff_access_carrier(carrier_id));

create policy load_charges_select on public.load_charges for select to authenticated
  using (app.can_staff_access_carrier(carrier_id) or app.carrier_can_see_load(load_id));
create policy load_charges_write on public.load_charges for all to authenticated
  using (app.can_staff_access_carrier(carrier_id)) with check (app.can_staff_access_carrier(carrier_id));

create policy load_notes_select on public.load_notes for select to authenticated
  using (app.can_staff_access_carrier(carrier_id) or (visibility = 'carrier' and app.carrier_can_see_load(load_id)));
create policy load_notes_insert_staff on public.load_notes for insert to authenticated
  with check (app.can_staff_access_carrier(carrier_id) and author_id = (select auth.uid()));
create policy load_notes_insert_carrier on public.load_notes for insert to authenticated
  with check (
    visibility = 'carrier' and kind = 'note' and author_id = (select auth.uid())
    and app.carrier_can_see_load(load_id)
  );

create policy load_status_history_select on public.load_status_history for select to authenticated
  using (app.can_staff_access_carrier(carrier_id) or app.carrier_can_see_load(load_id));

create policy load_approvals_select on public.load_approvals for select to authenticated
  using (app.can_staff_access_carrier(carrier_id) or app.carrier_can_see_load(load_id));

revoke update, delete, truncate on public.load_status_history, public.load_notes from authenticated, anon;
revoke delete, truncate on public.loads, public.load_approvals from authenticated, anon;
