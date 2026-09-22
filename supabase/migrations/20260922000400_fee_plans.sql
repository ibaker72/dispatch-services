-- =============================================================================
-- Dispatch fee plans and carrier fee contracts.
--
-- A fee plan is a pricing template. A carrier fee contract copies a plan's
-- terms onto a carrier for a date range; contract terms are immutable so a
-- pricing change is always a new contract. Completed loads additionally get an
-- immutable fee snapshot (see the billing migration).
-- =============================================================================

create table public.fee_plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{2,60}$'),
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 1000),
  model public.fee_model not null,
  percentage numeric(6, 4),
  flat_weekly_amount numeric(12, 2),
  include_detention boolean not null default true,
  include_layover boolean not null default true,
  include_tonu boolean not null default true,
  include_other boolean not null default false,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_plans_terms check (
    (model = 'percentage' and percentage > 0 and percentage < 1 and flat_weekly_amount is null)
    or (model = 'flat_weekly' and flat_weekly_amount > 0 and percentage is null)
  )
);
create unique index fee_plans_one_default on public.fee_plans (is_default) where is_default;
create trigger fee_plans_touch before update on public.fee_plans for each row execute function app.touch_updated_at();
create trigger fee_plans_audit after insert or update on public.fee_plans for each row execute function app.audit_row_change();

create table public.carrier_fee_contracts (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers (id),
  fee_plan_id uuid not null references public.fee_plans (id),
  model public.fee_model not null,
  percentage numeric(6, 4),
  flat_weekly_amount numeric(12, 2),
  include_detention boolean not null,
  include_layover boolean not null,
  include_tonu boolean not null,
  include_other boolean not null,
  effective_from date not null,
  effective_to date,
  effective daterange generated always as (daterange(effective_from, effective_to, '[)')) stored,
  notes text check (char_length(notes) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint carrier_fee_contracts_terms check (
    (model = 'percentage' and percentage > 0 and percentage < 1 and flat_weekly_amount is null)
    or (model = 'flat_weekly' and flat_weekly_amount > 0 and percentage is null)
  ),
  constraint carrier_fee_contracts_range check (effective_to is null or effective_to > effective_from),
  constraint carrier_fee_contracts_no_overlap exclude using gist (carrier_id with =, effective with &&)
);
create index carrier_fee_contracts_carrier_idx on public.carrier_fee_contracts (carrier_id, effective_from desc);

create or replace function app.guard_fee_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan record;
begin
  if tg_op = 'INSERT' then
    select * into plan from public.fee_plans p where p.id = new.fee_plan_id;
    if not found or not plan.active then
      raise exception 'fee plan is not active' using errcode = '23514';
    end if;
    -- Terms default to the plan's terms; admins may record negotiated terms explicitly.
    if new.model is null then
      new.model := plan.model;
      new.percentage := plan.percentage;
      new.flat_weekly_amount := plan.flat_weekly_amount;
    end if;
    new.include_detention := coalesce(new.include_detention, plan.include_detention);
    new.include_layover := coalesce(new.include_layover, plan.include_layover);
    new.include_tonu := coalesce(new.include_tonu, plan.include_tonu);
    new.include_other := coalesce(new.include_other, plan.include_other);
    new.created_by := coalesce(new.created_by, auth.uid());
    return new;
  end if;

  -- Only the end date may change, which is how a contract is superseded.
  if not app.only_columns_changed(to_jsonb(old), to_jsonb(new), array['effective_to', 'effective', 'notes']) then
    raise exception 'fee contract terms are immutable; end this contract and create a new one'
      using errcode = '42501', hint = 'immutable_record';
  end if;
  return new;
end
$$;
create trigger carrier_fee_contracts_guard before insert or update on public.carrier_fee_contracts
  for each row execute function app.guard_fee_contract();
create trigger carrier_fee_contracts_no_delete before delete on public.carrier_fee_contracts
  for each row execute function app.prevent_mutation();
create trigger carrier_fee_contracts_audit after insert or update on public.carrier_fee_contracts
  for each row execute function app.audit_row_change();

-- Contract in force for a carrier on a given date (business-local date).
create or replace function app.fee_contract_on(p_carrier uuid, p_on date)
returns public.carrier_fee_contracts
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from public.carrier_fee_contracts c
  where c.carrier_id = p_carrier and c.effective @> p_on
  limit 1
$$;

create or replace function app.business_timezone()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.value ->> 'timezone' from public.app_settings s where s.key = 'operations'),
    'America/Chicago'
  )
$$;

create or replace function app.business_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone app.business_timezone())::date
$$;

alter table public.fee_plans enable row level security;
alter table public.carrier_fee_contracts enable row level security;

create policy fee_plans_select on public.fee_plans for select to anon, authenticated
  using (active or (select app.is_staff()));
create policy fee_plans_insert on public.fee_plans for insert to authenticated with check ((select app.is_admin()));
create policy fee_plans_update on public.fee_plans for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
grant select on public.fee_plans to anon;

create policy carrier_fee_contracts_select on public.carrier_fee_contracts for select to authenticated
  using (app.can_read_carrier(carrier_id));
create policy carrier_fee_contracts_insert on public.carrier_fee_contracts for insert to authenticated
  with check ((select app.is_admin()));
create policy carrier_fee_contracts_update on public.carrier_fee_contracts for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

revoke delete, truncate on public.carrier_fee_contracts from authenticated, anon;
