-- =============================================================================
-- Billing ledger: fee snapshots, weekly statements, invoices and payments.
--
--   dispatch fee (percentage plans) = eligible completed-load revenue × contracted percentage
--   dispatch fee (flat plans)       = flat weekly amount × active trucks for the week
--
-- The carrier is the only party billed and the only payer accepted
-- (payer_type is constrained to 'carrier'). Freight payments flow directly
-- from brokers/factors to carriers and are never recorded as receipts here.
-- =============================================================================

create table public.fee_snapshots (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null unique,
  carrier_id uuid not null references public.carriers (id),
  truck_id uuid,
  driver_id uuid,
  contract_id uuid not null references public.carrier_fee_contracts (id),
  basis text not null check (basis in ('completed', 'cancelled_tonu')),
  fee_model public.fee_model not null,
  fee_percentage numeric(6, 4),
  flat_weekly_amount numeric(12, 2),
  include_detention boolean not null,
  include_layover boolean not null,
  include_tonu boolean not null,
  include_other boolean not null,
  gross_rate numeric(12, 2) not null,
  detention_total numeric(12, 2) not null,
  layover_total numeric(12, 2) not null,
  tonu_total numeric(12, 2) not null,
  other_charges_total numeric(12, 2) not null,
  lumper_reimbursement_total numeric(12, 2) not null,
  total_revenue numeric(12, 2) not null,
  eligible_revenue numeric(12, 2) not null,
  dispatch_fee numeric(12, 2) not null check (dispatch_fee >= 0),
  loaded_miles numeric(10, 1),
  deadhead_miles numeric(10, 1),
  completed_at timestamptz not null,
  statement_week date not null check (extract(isodow from statement_week) = 1),
  created_at timestamptz not null default now(),
  foreign key (load_id, carrier_id) references public.loads (id, carrier_id)
);
create index fee_snapshots_carrier_week_idx on public.fee_snapshots (carrier_id, statement_week);

create trigger fee_snapshots_immutable before update or delete on public.fee_snapshots
  for each row execute function app.prevent_mutation();

create or replace function app.create_fee_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.carrier_fee_contracts;
  tz text := app.business_timezone();
  closed_at timestamptz;
  basis text;
  gross numeric(12, 2);
  eligible numeric(12, 2);
begin
  if new.status = old.status then
    return null;
  end if;
  if new.status = 'completed' then
    basis := 'completed';
    closed_at := coalesce(new.completed_at, now());
    gross := coalesce(new.gross_rate, 0);
  elsif new.status = 'cancelled' and new.tonu_total > 0 then
    basis := 'cancelled_tonu';
    closed_at := coalesce(new.cancelled_at, now());
    gross := 0;
  else
    return null;
  end if;

  c := app.fee_contract_on(new.carrier_id, (closed_at at time zone tz)::date);
  if c.id is null and new.fee_contract_id is not null then
    select * into c from public.carrier_fee_contracts where id = new.fee_contract_id;
  end if;
  if c.id is null then
    raise exception 'no fee contract applies to this load; completion refused' using errcode = '23514',
      hint = 'fee_contract_required';
  end if;

  eligible := gross
    + case when c.include_detention then new.detention_total else 0 end
    + case when c.include_layover then new.layover_total else 0 end
    + case when c.include_tonu then new.tonu_total else 0 end
    + case when c.include_other then new.other_charges_total else 0 end;

  insert into public.fee_snapshots (
    load_id, carrier_id, truck_id, driver_id, contract_id, basis, fee_model, fee_percentage, flat_weekly_amount,
    include_detention, include_layover, include_tonu, include_other,
    gross_rate, detention_total, layover_total, tonu_total, other_charges_total, lumper_reimbursement_total,
    total_revenue, eligible_revenue, dispatch_fee, loaded_miles, deadhead_miles, completed_at, statement_week
  ) values (
    new.id, new.carrier_id, new.truck_id, new.driver_id, c.id, basis, c.model, c.percentage, c.flat_weekly_amount,
    c.include_detention, c.include_layover, c.include_tonu, c.include_other,
    gross, new.detention_total, new.layover_total, new.tonu_total, new.other_charges_total, new.lumper_reimbursement_total,
    gross + new.detention_total + new.layover_total + new.tonu_total + new.other_charges_total,
    eligible,
    case when c.model = 'percentage' then round(eligible * c.percentage, 2) else 0 end,
    new.loaded_miles, new.deadhead_miles, closed_at,
    date_trunc('week', closed_at at time zone tz)::date
  );
  return null;
end
$$;
create trigger loads_fee_snapshot after update of status on public.loads
  for each row execute function app.create_fee_snapshot();

-- -----------------------------------------------------------------------------
-- Weekly statements
-- -----------------------------------------------------------------------------
create table public.weekly_statements (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers (id),
  period_start date not null check (extract(isodow from period_start) = 1),
  period_end date generated always as (period_start + 6) stored,
  status public.statement_status not null default 'draft',
  fee_model public.fee_model,
  loads_count integer not null default 0,
  gross_load_revenue numeric(12, 2) not null default 0,
  additional_charges numeric(12, 2) not null default 0,
  eligible_revenue numeric(12, 2) not null default 0,
  dispatch_fee numeric(12, 2) not null default 0,
  credits_adjustments numeric(12, 2) not null default 0,
  amount_due numeric(12, 2) not null default 0,
  invoice_id uuid,
  generated_at timestamptz not null default now(),
  issued_at timestamptz,
  issued_by uuid references public.profiles (id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  void_reason text check (char_length(void_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, carrier_id)
);
create unique index weekly_statements_period_unique on public.weekly_statements (carrier_id, period_start) where status <> 'void';
create index weekly_statements_period_idx on public.weekly_statements (period_start desc);
create trigger weekly_statements_touch before update on public.weekly_statements for each row execute function app.touch_updated_at();

create table public.statement_line_items (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null,
  carrier_id uuid not null,
  line_type text not null check (line_type in ('load_fee', 'flat_weekly_fee', 'credit', 'adjustment')),
  load_id uuid,
  fee_snapshot_id uuid references public.fee_snapshots (id),
  truck_id uuid,
  description text not null check (char_length(description) between 1 and 300),
  gross_revenue numeric(12, 2) not null default 0,
  additional_charges numeric(12, 2) not null default 0,
  eligible_revenue numeric(12, 2) not null default 0,
  amount numeric(12, 2) not null,
  voided boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (statement_id, carrier_id) references public.weekly_statements (id, carrier_id),
  constraint statement_line_items_shape check (
    (line_type = 'load_fee' and fee_snapshot_id is not null and load_id is not null and amount >= 0)
    or (line_type = 'flat_weekly_fee' and truck_id is not null and amount >= 0)
    or (line_type = 'credit' and amount < 0)
    or (line_type = 'adjustment' and amount <> 0)
  )
);
create unique index statement_line_items_snapshot_once on public.statement_line_items (fee_snapshot_id)
  where fee_snapshot_id is not null and not voided;
create unique index statement_line_items_truck_once on public.statement_line_items (statement_id, truck_id)
  where line_type = 'flat_weekly_fee' and not voided;
create index statement_line_items_statement_idx on public.statement_line_items (statement_id);

create or replace function app.recalculate_statement(p_statement uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  prev text := app.begin_internal('ledger');
begin
  update public.weekly_statements s set
    loads_count = t.loads_count,
    gross_load_revenue = t.gross,
    additional_charges = t.additional,
    eligible_revenue = t.eligible,
    dispatch_fee = t.fees,
    credits_adjustments = t.credits,
    amount_due = t.fees + t.credits
  from (
    select
      count(*) filter (where li.line_type = 'load_fee') as loads_count,
      coalesce(sum(li.gross_revenue) filter (where li.line_type = 'load_fee'), 0) as gross,
      coalesce(sum(li.additional_charges) filter (where li.line_type = 'load_fee'), 0) as additional,
      coalesce(sum(li.eligible_revenue) filter (where li.line_type = 'load_fee'), 0) as eligible,
      coalesce(sum(li.amount) filter (where li.line_type in ('load_fee', 'flat_weekly_fee')), 0) as fees,
      coalesce(sum(li.amount) filter (where li.line_type in ('credit', 'adjustment')), 0) as credits
    from public.statement_line_items li
    where li.statement_id = p_statement and not li.voided
  ) t
  where s.id = p_statement;
  perform app.end_internal(prev);
end
$$;

create or replace function app.guard_statement_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.statement_status;
begin
  select s.status into st from public.weekly_statements s where s.id = coalesce(new.statement_id, old.statement_id);
  if tg_op = 'UPDATE' and not app.only_columns_changed(to_jsonb(old), to_jsonb(new), array['voided']) then
    raise exception 'statement lines are immutable' using errcode = '42501', hint = 'immutable_record';
  end if;
  if st <> 'draft' and not (tg_op = 'UPDATE' and st = 'void') then
    raise exception 'issued statements cannot be changed; void and regenerate instead' using errcode = '42501',
      hint = 'immutable_record';
  end if;
  if tg_op = 'INSERT' and not (app.is_system() or app.in_internal('ledger')) then
    if new.line_type not in ('credit', 'adjustment') then
      raise exception 'only credits and adjustments can be added manually' using errcode = '42501';
    end if;
    new.created_by := auth.uid();
  end if;
  if tg_op = 'DELETE' then
    if old.line_type not in ('credit', 'adjustment') and not (app.is_system() or app.in_internal('ledger')) then
      raise exception 'generated statement lines cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  return new;
end
$$;
create trigger statement_line_items_guard before insert or update or delete on public.statement_line_items
  for each row execute function app.guard_statement_line();

create or replace function app.after_statement_line_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.recalculate_statement(coalesce(new.statement_id, old.statement_id));
  return null;
end
$$;
create trigger statement_line_items_recalc after insert or delete on public.statement_line_items
  for each row execute function app.after_statement_line_change();
create trigger statement_line_items_audit after insert or delete on public.statement_line_items
  for each row execute function app.audit_row_change();

create or replace function app.guard_weekly_statement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.carrier_id <> old.carrier_id or new.period_start <> old.period_start then
      raise exception 'statement period and carrier are immutable' using errcode = '42501';
    end if;
    if old.status = 'void' then
      raise exception 'void statements are closed records' using errcode = '42501', hint = 'immutable_record';
    end if;
    if not (app.is_system() or app.in_internal('ledger')) then
      if not app.only_columns_changed(to_jsonb(old), to_jsonb(new),
           array['status', 'voided_at', 'voided_by', 'void_reason', 'updated_at', 'period_end']) then
        raise exception 'statement totals are computed from line items' using errcode = '42501';
      end if;
      if new.status is distinct from old.status and new.status <> 'void' then
        raise exception 'statements are issued with issue_weekly_statement()' using errcode = '42501';
      end if;
    end if;
    if old.status = 'issued' and not (
      new.status = 'void'
      and app.only_columns_changed(to_jsonb(old), to_jsonb(new),
            array['status', 'voided_at', 'voided_by', 'void_reason', 'updated_at', 'period_end'])
    ) then
      raise exception 'issued statements are immutable; void to correct' using errcode = '42501',
        hint = 'immutable_record';
    end if;
    if new.status = 'void' and old.status <> 'void' then
      if new.void_reason is null then
        raise exception 'a void reason is required' using errcode = '23514', hint = 'reason_required';
      end if;
      if new.invoice_id is not null and exists (
        select 1 from public.invoices i where i.id = new.invoice_id and i.status not in ('void')
      ) then
        raise exception 'void the related invoice first' using errcode = '23514';
      end if;
      new.voided_at := now();
      new.voided_by := auth.uid();
      update public.statement_line_items set voided = true where statement_id = new.id;
    end if;
  end if;
  return new;
end
$$;
create trigger weekly_statements_guard before update on public.weekly_statements
  for each row execute function app.guard_weekly_statement();
create trigger weekly_statements_no_delete before delete on public.weekly_statements
  for each row execute function app.prevent_mutation();
create trigger weekly_statements_audit after insert or update on public.weekly_statements
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- Invoices and payments
-- -----------------------------------------------------------------------------
create sequence public.invoice_number_seq;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers (id),
  statement_id uuid unique,
  invoice_number text not null unique
    default ('INV-' || to_char(now() at time zone 'UTC', 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0')),
  status public.invoice_status not null default 'draft',
  payer_type text not null default 'carrier' check (payer_type = 'carrier'),
  currency char(3) not null default 'usd' check (currency = 'usd'),
  issue_date date,
  due_date date,
  subtotal numeric(12, 2) not null default 0,
  credits numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0 check (total >= 0),
  amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),
  balance_due numeric(12, 2) generated always as (total - amount_paid) stored,
  memo text check (char_length(memo) <= 2000),
  stripe_checkout_session_id text,
  sent_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  void_reason text check (char_length(void_reason) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, carrier_id),
  foreign key (statement_id, carrier_id) references public.weekly_statements (id, carrier_id),
  constraint invoices_due_after_issue check (due_date is null or issue_date is null or due_date >= issue_date)
);
create index invoices_carrier_status_idx on public.invoices (carrier_id, status);
create index invoices_due_idx on public.invoices (due_date) where status = 'open';
create trigger invoices_touch before update on public.invoices for each row execute function app.touch_updated_at();

alter table public.weekly_statements
  add constraint weekly_statements_invoice_fk foreign key (invoice_id) references public.invoices (id);

create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  carrier_id uuid not null,
  description text not null check (char_length(description) between 1 and 300),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit_amount numeric(12, 2) not null,
  amount numeric(12, 2) generated always as (round(quantity * unit_amount, 2)) stored,
  created_at timestamptz not null default now(),
  foreign key (invoice_id, carrier_id) references public.invoices (id, carrier_id)
);
create index invoice_line_items_invoice_idx on public.invoice_line_items (invoice_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  carrier_id uuid not null,
  payer_type text not null default 'carrier' check (payer_type = 'carrier'),
  amount numeric(12, 2) not null check (amount > 0),
  method public.payment_method not null,
  status public.payment_status not null default 'succeeded',
  reference text check (char_length(reference) <= 200),
  stripe_event_id text unique,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  received_at timestamptz not null default now(),
  recorded_by uuid references public.profiles (id) on delete set null,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (invoice_id, carrier_id) references public.invoices (id, carrier_id),
  constraint payments_stripe_fields check (method = 'stripe' or (stripe_event_id is null and stripe_payment_intent_id is null))
);
create index payments_invoice_idx on public.payments (invoice_id);
create trigger payments_touch before update on public.payments for each row execute function app.touch_updated_at();

create or replace function app.recalculate_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  paid numeric(12, 2);
  prev text := app.begin_internal('ledger');
begin
  select * into inv from public.invoices where id = p_invoice for update;
  select coalesce(sum(amount) filter (where status = 'succeeded'), 0) into paid
  from public.payments where invoice_id = p_invoice;

  if inv.status = 'draft' then
    update public.invoices i set
      subtotal = coalesce((select sum(amount) from public.invoice_line_items where invoice_id = p_invoice and amount > 0), 0),
      credits = coalesce((select sum(amount) from public.invoice_line_items where invoice_id = p_invoice and amount < 0), 0),
      total = greatest(coalesce((select sum(amount) from public.invoice_line_items where invoice_id = p_invoice), 0), 0),
      amount_paid = paid
    where i.id = p_invoice;
  else
    update public.invoices i set
      amount_paid = paid,
      status = case
        when i.status in ('open', 'uncollectible') and paid >= i.total and i.total > 0 then 'paid'::public.invoice_status
        when i.status = 'paid' and paid < i.total then 'open'::public.invoice_status
        else i.status
      end,
      paid_at = case
        when i.status in ('open', 'uncollectible') and paid >= i.total and i.total > 0 then now()
        when i.status = 'paid' and paid < i.total then null
        else i.paid_at
      end
    where i.id = p_invoice;
  end if;
  perform app.end_internal(prev);
end
$$;

create or replace function app.guard_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'invoices start as drafts' using errcode = '23514';
    end if;
    new.created_by := coalesce(new.created_by, auth.uid());
    new.amount_paid := 0;
    return new;
  end if;

  if new.carrier_id <> old.carrier_id or new.invoice_number <> old.invoice_number
     or new.statement_id is distinct from old.statement_id then
    raise exception 'invoice identity is immutable' using errcode = '42501';
  end if;
  if old.status in ('void', 'paid') and new.status = old.status and not app.is_system()
     and not app.only_columns_changed(to_jsonb(old), to_jsonb(new), array['memo', 'updated_at', 'sent_at', 'balance_due']) then
    raise exception 'closed invoices are immutable' using errcode = '42501', hint = 'immutable_record';
  end if;
  if not (app.is_system() or app.in_internal('ledger')) and (
       new.total <> old.total or new.subtotal <> old.subtotal or new.credits <> old.credits
       or new.amount_paid <> old.amount_paid or new.paid_at is distinct from old.paid_at) then
    raise exception 'invoice amounts are computed from line items and payments' using errcode = '42501';
  end if;
  if old.status <> 'draft' and (new.total <> old.total or new.subtotal <> old.subtotal or new.credits <> old.credits) then
    raise exception 'issued invoice amounts are immutable' using errcode = '42501', hint = 'immutable_record';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('open', 'void'))
      or (old.status = 'open' and new.status in ('paid', 'void', 'uncollectible'))
      or (old.status = 'uncollectible' and new.status in ('paid', 'open', 'void'))
      or (old.status = 'paid' and new.status = 'open' and (app.is_system() or app.in_internal('ledger')))
    ) then
      raise exception 'invalid invoice status transition % -> %', old.status, new.status using errcode = '23514',
        hint = 'invalid_transition';
    end if;
    if new.status = 'paid' and (new.amount_paid < new.total or not (app.is_system() or app.in_internal('ledger'))) then
      raise exception 'invoice cannot be marked paid before payment is recorded' using errcode = '23514',
        hint = 'payment_required';
    end if;
    if new.status = 'open' and old.status = 'draft' then
      if new.total <= 0 then
        raise exception 'an invoice must have a positive total' using errcode = '23514';
      end if;
      new.issue_date := coalesce(new.issue_date, app.business_today());
      new.due_date := coalesce(new.due_date, new.issue_date + 7);
    end if;
    if new.status = 'void' then
      if new.amount_paid > 0 then
        raise exception 'invoices with recorded payments cannot be voided' using errcode = '23514';
      end if;
      if new.void_reason is null then
        raise exception 'a void reason is required' using errcode = '23514', hint = 'reason_required';
      end if;
      new.voided_at := now();
      new.voided_by := auth.uid();
    end if;
  end if;
  return new;
end
$$;
create trigger invoices_guard before insert or update on public.invoices
  for each row execute function app.guard_invoice();
create trigger invoices_no_delete before delete on public.invoices
  for each row execute function app.prevent_mutation();
create trigger invoices_audit after insert or update on public.invoices
  for each row execute function app.audit_row_change();

create or replace function app.guard_invoice_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.invoice_status;
begin
  select i.status into st from public.invoices i where i.id = coalesce(new.invoice_id, old.invoice_id);
  if st <> 'draft' then
    raise exception 'issued invoice lines are immutable' using errcode = '42501', hint = 'immutable_record';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;
create trigger invoice_line_items_guard before insert or update or delete on public.invoice_line_items
  for each row execute function app.guard_invoice_line();

create or replace function app.after_invoice_line_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.recalculate_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end
$$;
create trigger invoice_line_items_recalc after insert or update or delete on public.invoice_line_items
  for each row execute function app.after_invoice_line_change();

create or replace function app.guard_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
begin
  if tg_op = 'INSERT' then
    select * into inv from public.invoices where id = new.invoice_id;
    if inv.status not in ('open', 'uncollectible') and not (new.method = 'stripe' and inv.status = 'paid') then
      raise exception 'payments can only be recorded against open invoices' using errcode = '23514';
    end if;
    if new.method <> 'stripe' and new.status = 'succeeded' and new.amount > inv.balance_due then
      raise exception 'payment exceeds the balance due' using errcode = '23514', hint = 'overpayment';
    end if;
    if new.method = 'stripe' and not app.is_system() then
      raise exception 'card/ACH payments are recorded only from verified Stripe events' using errcode = '42501';
    end if;
    new.recorded_by := coalesce(new.recorded_by, auth.uid());
    return new;
  end if;

  if not app.only_columns_changed(to_jsonb(old), to_jsonb(new), array['status', 'notes', 'updated_at']) then
    raise exception 'payments are immutable except for status and notes' using errcode = '42501',
      hint = 'immutable_record';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('succeeded', 'failed'))
    or (old.status = 'succeeded' and new.status = 'refunded')
  ) then
    raise exception 'invalid payment status change' using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger payments_guard before insert or update on public.payments
  for each row execute function app.guard_payment();
create trigger payments_no_delete before delete on public.payments
  for each row execute function app.prevent_mutation();

create or replace function app.after_payment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.recalculate_invoice(new.invoice_id);
  return null;
end
$$;
create trigger payments_recalc after insert or update on public.payments
  for each row execute function app.after_payment_change();
create trigger payments_audit after insert or update on public.payments
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- Statement generation and issuing (idempotent; admin or server jobs)
-- -----------------------------------------------------------------------------
create or replace function public.generate_weekly_statement(p_carrier_id uuid, p_period_start date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  stmt public.weekly_statements;
  c public.carrier_fee_contracts;
  car public.carriers;
  period_end date := p_period_start + 6;
  prev text;
begin
  if not (app.is_system() or app.is_admin()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if extract(isodow from p_period_start) <> 1 then
    raise exception 'statement periods start on Monday' using errcode = '22023';
  end if;

  select * into car from public.carriers where id = p_carrier_id;
  if not found then
    raise exception 'carrier not found' using errcode = 'P0002';
  end if;

  select * into stmt from public.weekly_statements
  where carrier_id = p_carrier_id and period_start = p_period_start and status <> 'void'
  for update;

  if found and stmt.status = 'issued' then
    return stmt.id; -- already issued: idempotent no-op
  end if;

  c := coalesce(app.fee_contract_on(p_carrier_id, period_end), app.fee_contract_on(p_carrier_id, p_period_start));
  prev := app.begin_internal('ledger');

  if stmt.id is null then
    insert into public.weekly_statements (carrier_id, period_start, fee_model)
    values (p_carrier_id, p_period_start, c.model)
    returning * into stmt;
  else
    delete from public.statement_line_items
    where statement_id = stmt.id and line_type in ('load_fee', 'flat_weekly_fee');
    update public.weekly_statements set fee_model = c.model, generated_at = now() where id = stmt.id;
  end if;

  insert into public.statement_line_items (
    statement_id, carrier_id, line_type, load_id, fee_snapshot_id, truck_id, description,
    gross_revenue, additional_charges, eligible_revenue, amount
  )
  select stmt.id, fs.carrier_id, 'load_fee', fs.load_id, fs.id, fs.truck_id,
         left(format('Load %s%s', l.reference, case when fs.basis = 'cancelled_tonu' then ' (TONU)' else '' end), 300),
         fs.gross_rate,
         fs.detention_total + fs.layover_total + fs.tonu_total + fs.other_charges_total,
         fs.eligible_revenue,
         fs.dispatch_fee
  from public.fee_snapshots fs
  join public.loads l on l.id = fs.load_id
  where fs.carrier_id = p_carrier_id and fs.statement_week = p_period_start
    and not exists (
      select 1 from public.statement_line_items li
      where li.fee_snapshot_id = fs.id and not li.voided
    );

  if c.model = 'flat_weekly'
     and car.activated_at is not null
     and (car.activated_at at time zone app.business_timezone())::date <= period_end
     and (car.deactivated_at is null or (car.deactivated_at at time zone app.business_timezone())::date >= p_period_start) then
    insert into public.statement_line_items (statement_id, carrier_id, line_type, truck_id, description, amount)
    select stmt.id, p_carrier_id, 'flat_weekly_fee', t.id,
           left(format('Flat weekly dispatch fee — unit %s', t.unit_number), 300),
           c.flat_weekly_amount
    from public.trucks t
    where t.carrier_id = p_carrier_id and t.status = 'active'
      and (t.created_at at time zone app.business_timezone())::date <= period_end;
  end if;

  perform app.recalculate_statement(stmt.id);
  perform app.end_internal(prev);
  return stmt.id;
end
$$;

create or replace function public.issue_weekly_statement(p_statement_id uuid, p_due_days integer default 7)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  stmt public.weekly_statements;
  inv_id uuid;
  prev text;
begin
  if not (app.is_system() or app.is_admin()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_due_days not between 0 and 60 then
    raise exception 'due days must be between 0 and 60' using errcode = '22023';
  end if;
  select * into stmt from public.weekly_statements where id = p_statement_id for update;
  if not found then
    raise exception 'statement not found' using errcode = 'P0002';
  end if;
  if stmt.status = 'issued' then
    return stmt.invoice_id;
  end if;
  if stmt.status <> 'draft' then
    raise exception 'only draft statements can be issued' using errcode = '23514';
  end if;
  if stmt.amount_due < 0 then
    raise exception 'statement total is negative; adjust credits before issuing' using errcode = '23514';
  end if;

  prev := app.begin_internal('ledger');
  if stmt.amount_due > 0 then
    insert into public.invoices (carrier_id, statement_id, memo)
    values (stmt.carrier_id, stmt.id,
            format('Dispatch services for %s – %s', to_char(stmt.period_start, 'Mon DD, YYYY'), to_char(stmt.period_end, 'Mon DD, YYYY')))
    returning id into inv_id;

    insert into public.invoice_line_items (invoice_id, carrier_id, description, unit_amount)
    values (inv_id, stmt.carrier_id,
            format('Dispatch fees, week of %s', to_char(stmt.period_start, 'Mon DD, YYYY')), stmt.dispatch_fee);
    if stmt.credits_adjustments <> 0 then
      insert into public.invoice_line_items (invoice_id, carrier_id, description, unit_amount)
      values (inv_id, stmt.carrier_id, 'Credits and adjustments', stmt.credits_adjustments);
    end if;

    update public.invoices
    set status = 'open', issue_date = app.business_today(), due_date = app.business_today() + p_due_days
    where id = inv_id;
  end if;

  update public.weekly_statements
  set status = 'issued', issued_at = now(), issued_by = auth.uid(), invoice_id = inv_id
  where id = stmt.id;
  perform app.end_internal(prev);
  return inv_id;
end
$$;

revoke execute on function public.generate_weekly_statement(uuid, date) from anon, public;
revoke execute on function public.issue_weekly_statement(uuid, integer) from anon, public;
grant execute on function public.generate_weekly_statement(uuid, date) to authenticated, service_role;
grant execute on function public.issue_weekly_statement(uuid, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.fee_snapshots enable row level security;
alter table public.weekly_statements enable row level security;
alter table public.statement_line_items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.payments enable row level security;

create policy fee_snapshots_select on public.fee_snapshots for select to authenticated
  using (app.can_read_carrier(carrier_id));

create policy weekly_statements_select on public.weekly_statements for select to authenticated
  using (app.can_staff_access_carrier(carrier_id) or (status <> 'draft' and app.is_carrier_member(carrier_id)));
create policy weekly_statements_update on public.weekly_statements for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy statement_line_items_select on public.statement_line_items for select to authenticated
  using (
    app.can_staff_access_carrier(carrier_id)
    or (app.is_carrier_member(carrier_id) and exists (
      select 1 from public.weekly_statements s where s.id = statement_id and s.status <> 'draft'
    ))
  );
create policy statement_line_items_insert on public.statement_line_items for insert to authenticated
  with check ((select app.is_admin()));
create policy statement_line_items_delete on public.statement_line_items for delete to authenticated
  using ((select app.is_admin()));

create policy invoices_select on public.invoices for select to authenticated
  using (app.can_staff_access_carrier(carrier_id) or (status <> 'draft' and app.is_carrier_member(carrier_id)));
create policy invoices_insert on public.invoices for insert to authenticated with check ((select app.is_admin()));
create policy invoices_update on public.invoices for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy invoice_line_items_select on public.invoice_line_items for select to authenticated
  using (
    app.can_staff_access_carrier(carrier_id)
    or (app.is_carrier_member(carrier_id) and exists (
      select 1 from public.invoices i where i.id = invoice_id and i.status <> 'draft'
    ))
  );
create policy invoice_line_items_write on public.invoice_line_items for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy payments_select on public.payments for select to authenticated
  using (app.can_read_carrier(carrier_id));
create policy payments_insert on public.payments for insert to authenticated with check ((select app.is_admin()));
create policy payments_update on public.payments for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

revoke update, delete, truncate on public.fee_snapshots from authenticated, anon, service_role;
revoke delete, truncate on public.payments, public.invoices, public.weekly_statements from authenticated, anon;
