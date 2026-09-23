-- =============================================================================
-- Atomic admin workflows. SECURITY INVOKER: the caller's RLS policies and the
-- table guard triggers still apply; these only make multi-row changes atomic.
-- =============================================================================

-- Replace a carrier's dispatch fee terms from a date: ends the open contract
-- the day the new one starts, so terms never overlap or leave a gap.
create or replace function public.replace_fee_contract(
  p_carrier_id uuid,
  p_fee_plan_id uuid,
  p_effective_from date,
  p_notes text,
  p_model public.fee_model default null,
  p_percentage numeric default null,
  p_flat_weekly_amount numeric default null,
  p_include_detention boolean default null,
  p_include_layover boolean default null,
  p_include_tonu boolean default null,
  p_include_other boolean default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cur public.carrier_fee_contracts;
  new_id uuid;
begin
  if not app.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into cur from public.carrier_fee_contracts
  where carrier_id = p_carrier_id and effective_to is null
  for update;
  if found then
    if cur.effective_from >= p_effective_from then
      raise exception 'new terms must start after %', cur.effective_from using errcode = '22023';
    end if;
    update public.carrier_fee_contracts set effective_to = p_effective_from where id = cur.id;
  end if;
  insert into public.carrier_fee_contracts (
    carrier_id, fee_plan_id, model, percentage, flat_weekly_amount,
    include_detention, include_layover, include_tonu, include_other, effective_from, notes
  ) values (
    p_carrier_id, p_fee_plan_id, p_model,
    case when p_model = 'percentage' then p_percentage end,
    case when p_model = 'flat_weekly' then p_flat_weekly_amount end,
    p_include_detention, p_include_layover, p_include_tonu, p_include_other, p_effective_from, p_notes
  ) returning id into new_id;
  return new_id;
end
$$;
revoke all on function public.replace_fee_contract(uuid, uuid, date, text, public.fee_model, numeric, numeric, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.replace_fee_contract(uuid, uuid, date, text, public.fee_model, numeric, numeric, boolean, boolean, boolean, boolean) to authenticated;

-- Assign a dispatcher to a carrier (optionally as primary) in one step.
create or replace function public.assign_dispatcher(p_carrier_id uuid, p_dispatcher_id uuid, p_primary boolean, p_note text default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not app.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update public.dispatcher_assignments set ended_at = now()
  where carrier_id = p_carrier_id and dispatcher_id = p_dispatcher_id and ended_at is null;
  if p_primary then
    update public.dispatcher_assignments set is_primary = false
    where carrier_id = p_carrier_id and is_primary and ended_at is null;
  end if;
  insert into public.dispatcher_assignments (carrier_id, dispatcher_id, is_primary, note)
  values (p_carrier_id, p_dispatcher_id, p_primary, nullif(trim(p_note), ''))
  returning id into new_id;
  return new_id;
end
$$;
revoke all on function public.assign_dispatcher(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.assign_dispatcher(uuid, uuid, boolean, text) to authenticated;
