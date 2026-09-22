-- =============================================================================
-- Workflow functions: onboarding checklist, application approval, invitation
-- acceptance, cancellation requests and dashboard metrics.
-- =============================================================================

-- Onboarding checklist. Data-driven: required agreements and documents come
-- from the agreements / document_requirements tables that admins manage.
create or replace function app.carrier_onboarding_steps(p_carrier uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.carriers;
  steps jsonb := '[]'::jsonb;
  today date := app.business_today();
  r record;
  ok boolean;
begin
  select * into c from public.carriers where id = p_carrier;
  if not found then
    return steps;
  end if;

  steps := steps || jsonb_build_object('key', 'application_approved', 'label', 'Application approved',
    'complete', c.application_id is null or exists (
      select 1 from public.carrier_applications a
      where a.id = c.application_id and a.status in ('approved', 'onboarding', 'active', 'inactive')));

  steps := steps || jsonb_build_object('key', 'account_invitation', 'label', 'Owner account created from invitation',
    'complete', exists (
      select 1 from public.organization_members m
      where m.organization_id = c.organization_id and m.role = 'carrier_owner' and m.status = 'active'));

  for r in
    select a.key, a.title from public.agreements a
    where a.active and a.required_for_activation and a.audience = 'carrier'
    order by a.sort_order, a.title
  loop
    ok := exists (
      select 1 from public.agreement_versions v
      join public.agreement_acceptances aa on aa.agreement_version_id = v.id
      join public.agreements a on a.id = v.agreement_id
      where a.key = r.key and v.status = 'published' and aa.carrier_id = p_carrier
        and aa.revoked_at is null and aa.terminated_at is null);
    steps := steps || jsonb_build_object('key', 'agreement:' || r.key, 'label', r.title || ' accepted', 'complete', ok,
      'published', exists (
        select 1 from public.agreement_versions v join public.agreements a on a.id = v.agreement_id
        where a.key = r.key and v.status = 'published'));
  end loop;

  for r in
    select dr.doc_type, dr.label, dr.tracks_expiration from public.document_requirements dr
    where dr.active and dr.applies_to = 'carrier' and dr.required_for_activation
    order by dr.sort_order, dr.label
  loop
    ok := exists (
      select 1 from public.documents d
      where d.carrier_id = p_carrier and d.doc_type = r.doc_type and d.status = 'accepted' and d.deleted_at is null
        and d.load_id is null and d.driver_id is null and d.truck_id is null
        and (not r.tracks_expiration or d.expires_on >= today));
    steps := steps || jsonb_build_object('key', 'document:' || r.doc_type, 'label', r.label || ' on file and accepted',
      'complete', ok,
      'uploaded', exists (
        select 1 from public.documents d
        where d.carrier_id = p_carrier and d.doc_type = r.doc_type and d.deleted_at is null
          and d.status in ('pending_review', 'accepted')));
  end loop;

  steps := steps || jsonb_build_object('key', 'insurance_current', 'label', 'Insurance expiration date is current',
    'complete', c.insurance_expiration_date is not null and c.insurance_expiration_date >= today);
  steps := steps || jsonb_build_object('key', 'authority_verified', 'label', 'Operating authority verified',
    'complete', c.authority_verification_status = 'verified');
  steps := steps || jsonb_build_object('key', 'factoring', 'label', 'Factoring information provided',
    'complete', c.factoring_status <> 'unknown' and (c.factoring_status <> 'factoring' or c.factoring_company_name is not null));
  steps := steps || jsonb_build_object('key', 'dispatcher_assigned', 'label', 'Primary dispatcher assigned',
    'complete', exists (
      select 1 from public.dispatcher_assignments da
      where da.carrier_id = p_carrier and da.ended_at is null and da.is_primary));
  steps := steps || jsonb_build_object('key', 'fleet_setup', 'label', 'At least one active truck and driver',
    'complete', exists (select 1 from public.trucks t where t.carrier_id = p_carrier and t.status = 'active')
      and exists (select 1 from public.drivers d where d.carrier_id = p_carrier and d.status = 'active'));
  steps := steps || jsonb_build_object('key', 'fee_contract', 'label', 'Dispatch fee terms recorded',
    'complete', (app.fee_contract_on(p_carrier, today)).id is not null);
  return steps;
end
$$;

create or replace function app.carrier_onboarding_complete(p_carrier uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from jsonb_array_elements(app.carrier_onboarding_steps(p_carrier)) s
    where (s ->> 'complete')::boolean is not true
  )
$$;

create or replace function public.get_carrier_onboarding(p_carrier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  steps jsonb;
begin
  if not app.can_read_carrier(p_carrier_id) then
    raise exception 'carrier not found' using errcode = 'P0002';
  end if;
  steps := app.carrier_onboarding_steps(p_carrier_id);
  return jsonb_build_object(
    'steps', steps,
    'complete', not exists (select 1 from jsonb_array_elements(steps) s where (s ->> 'complete')::boolean is not true)
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Application approval: atomically creates the carrier organization, carrier,
-- initial fleet, lane preferences and fee contract, and attaches the
-- application's documents. The portal invitation is sent by the server.
-- -----------------------------------------------------------------------------
create or replace function app.json_array(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end
$$;

create or replace function public.approve_application(
  p_application_id uuid,
  p_fee_plan_key text default null,
  p_dispatcher_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.carrier_applications;
  fd jsonb;
  org_id uuid;
  car_id uuid;
  plan public.fee_plans;
  prev text;
  item jsonb;
  n integer := 0;
  st text;
begin
  if not (app.is_system() or app.is_admin()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into a from public.carrier_applications where id = p_application_id for update;
  if not found then
    raise exception 'application not found' using errcode = 'P0002';
  end if;
  if a.status not in ('submitted', 'under_review') or a.carrier_id is not null then
    raise exception 'only submitted applications can be approved' using errcode = '23514', hint = 'invalid_transition';
  end if;
  if a.legal_name is null or a.email is null then
    raise exception 'application is missing a legal name or email' using errcode = '23514';
  end if;

  select * into plan from public.fee_plans p
  where p.active and ((p_fee_plan_key is null and p.is_default) or p.key = p_fee_plan_key)
  order by (p.key = p_fee_plan_key) desc nulls last
  limit 1;
  if plan.id is null then
    raise exception 'no active fee plan found' using errcode = '23514';
  end if;

  fd := a.form_data;
  prev := app.begin_internal('carrier_lifecycle');

  insert into public.organizations (name) values (a.legal_name) returning id into org_id;

  insert into public.carriers (
    organization_id, application_id, legal_name, dba_name, mc_number, usdot_number, ein_last4,
    years_in_business, authority_active_date, email, phone, address_line1, address_line2, city, state,
    postal_code, home_base_city, home_base_state, min_rate_per_mile, desired_weekly_gross, days_available,
    max_deadhead_miles, preferences_notes, factoring_status, factoring_company_name, insurance_expiration_date
  ) values (
    org_id, a.id, a.legal_name, a.dba_name, a.mc_number, a.usdot_number,
    nullif(fd #>> '{business,einLast4}', ''),
    nullif(fd #>> '{business,yearsInBusiness}', '')::numeric,
    nullif(fd #>> '{business,authorityActiveDate}', '')::date,
    a.email, a.phone,
    nullif(fd #>> '{business,addressLine1}', ''), nullif(fd #>> '{business,addressLine2}', ''),
    nullif(fd #>> '{business,city}', ''), upper(nullif(fd #>> '{business,state}', '')),
    nullif(fd #>> '{business,postalCode}', ''),
    nullif(fd #>> '{lanes,homeBaseCity}', ''), upper(nullif(fd #>> '{lanes,homeBaseState}', '')),
    nullif(fd #>> '{preferences,minRatePerMile}', '')::numeric,
    nullif(fd #>> '{preferences,desiredWeeklyGross}', '')::numeric,
    coalesce(array(select jsonb_array_elements_text(app.json_array(fd #> '{preferences,daysAvailable}'))), '{}'),
    nullif(fd #>> '{preferences,maxDeadheadMiles}', '')::integer,
    nullif(fd #>> '{preferences,notes}', ''),
    coalesce(nullif(fd #>> '{factoring,status}', ''), 'unknown'),
    nullif(fd #>> '{factoring,companyName}', ''),
    nullif(fd #>> '{documents,insuranceExpirationDate}', '')::date
  ) returning id into car_id;

  for item in select value from jsonb_array_elements(app.json_array(fd #> '{equipment,trucks}')) loop
    n := n + 1;
    insert into public.trucks (carrier_id, unit_number, equipment_type, year, make, model, vehicle_capacity, max_payload_lbs)
    values (
      car_id,
      coalesce(nullif(item ->> 'unitNumber', ''), 'Truck ' || n),
      coalesce(nullif(item ->> 'equipmentType', ''), a.primary_equipment_type),
      nullif(item ->> 'year', '')::smallint,
      nullif(item ->> 'make', ''), nullif(item ->> 'model', ''),
      nullif(item ->> 'vehicleCapacity', '')::smallint,
      nullif(item ->> 'maxPayloadLbs', '')::numeric
    );
  end loop;

  for item in select value from jsonb_array_elements(app.json_array(fd #> '{equipment,trailers}')) loop
    insert into public.trailers (carrier_id, trailer_type, length_ft, vehicle_capacity, max_payload_lbs)
    values (
      car_id,
      coalesce(nullif(item ->> 'trailerType', ''), 'other'),
      nullif(item ->> 'lengthFt', '')::numeric,
      nullif(item ->> 'vehicleCapacity', '')::smallint,
      nullif(item ->> 'maxPayloadLbs', '')::numeric
    );
  end loop;

  for item in select value from jsonb_array_elements(app.json_array(fd #> '{drivers,drivers}')) loop
    insert into public.drivers (carrier_id, full_name, email, phone, is_owner_operator)
    values (
      car_id,
      item ->> 'fullName',
      nullif(item ->> 'email', ''),
      nullif(item ->> 'phone', ''),
      coalesce((item ->> 'isOwnerOperator')::boolean, false)
    );
  end loop;

  for st in select jsonb_array_elements_text(app.json_array(fd #> '{lanes,preferredStates}')) loop
    insert into public.lane_preferences (carrier_id, preference, destination_state) values (car_id, 'preferred', upper(st));
  end loop;
  for st in select jsonb_array_elements_text(app.json_array(fd #> '{lanes,avoidStates}')) loop
    insert into public.lane_preferences (carrier_id, preference, destination_state) values (car_id, 'avoid', upper(st));
  end loop;
  for item in select value from jsonb_array_elements(app.json_array(fd #> '{lanes,preferredLanes}')) loop
    insert into public.lane_preferences (carrier_id, preference, origin_state, destination_state)
    values (car_id, 'preferred', upper(nullif(item ->> 'originState', '')), upper(nullif(item ->> 'destinationState', '')));
  end loop;

  update public.documents set carrier_id = car_id
  where application_id = a.id and carrier_id is null and deleted_at is null;

  insert into public.carrier_fee_contracts (carrier_id, fee_plan_id, effective_from, notes)
  values (car_id, plan.id, app.business_today(), 'Created at application approval');

  if p_dispatcher_id is not null then
    insert into public.dispatcher_assignments (carrier_id, dispatcher_id, is_primary)
    values (car_id, p_dispatcher_id, true);
  end if;

  update public.carrier_applications
  set status = 'approved', carrier_id = car_id, decision_reason = nullif(trim(p_note), '')
  where id = a.id;

  insert into public.tasks (title, description, kind, carrier_id, application_id, priority, source, dedupe_key)
  values (
    'Complete onboarding: ' || a.legal_name,
    'Send the portal invitation, verify authority, review documents and assign a primary dispatcher.',
    'onboarding', car_id, a.id, 'high', 'system', 'onboarding:' || car_id::text
  );

  perform app.end_internal(prev);
  return car_id;
end
$$;

-- -----------------------------------------------------------------------------
-- Invitation acceptance (the signed-in user accepts their own invitation)
-- -----------------------------------------------------------------------------
create or replace function public.accept_organization_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.organization_invitations;
  user_email text;
  car_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  select * into inv from public.organization_invitations
  where token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
  for update;
  if not found or inv.revoked_at is not null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if inv.accepted_at is not null then
    if inv.accepted_by = auth.uid() then
      return inv.organization_id;
    end if;
    raise exception 'invitation already used' using errcode = '23514', hint = 'invitation_used';
  end if;
  if inv.expires_at < now() then
    raise exception 'invitation expired' using errcode = '23514', hint = 'invitation_expired';
  end if;
  select u.email into user_email from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if user_email is null or lower(user_email) <> lower(inv.email::text) then
    raise exception 'this invitation was sent to a different email address' using errcode = '42501',
      hint = 'invitation_email_mismatch';
  end if;

  insert into public.organization_members (organization_id, user_id, role, invited_by)
  values (inv.organization_id, auth.uid(), inv.role, inv.invited_by)
  on conflict (organization_id, user_id) do update set status = 'active', role = excluded.role, removed_at = null, removed_by = null;

  update public.organization_invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;

  if inv.role = 'carrier_owner' then
    select c.id into car_id from public.carriers c where c.organization_id = inv.organization_id;
    update public.carrier_applications a set status = 'onboarding'
    where a.carrier_id = car_id and a.status = 'approved';
  end if;

  perform app.audit('invitation.accepted', 'organization', inv.organization_id::text, car_id,
                    jsonb_build_object('role', inv.role), 'security');
  return inv.organization_id;
end
$$;

-- -----------------------------------------------------------------------------
-- Carrier-initiated cancellation of the dispatch service
-- -----------------------------------------------------------------------------
create or replace function public.request_carrier_cancellation(p_carrier_id uuid, p_reason text)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.carriers;
  notice_days integer;
  effective date;
  prev text;
begin
  if not app.is_carrier_owner(p_carrier_id) then
    raise exception 'carrier not found' using errcode = 'P0002';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 or char_length(p_reason) > 2000 then
    raise exception 'please describe the reason for cancelling' using errcode = '22023', hint = 'reason_required';
  end if;
  select * into c from public.carriers where id = p_carrier_id for update;
  if c.cancellation_requested_at is not null then
    return c.cancellation_effective_date;
  end if;

  notice_days := coalesce(
    (select (s.value ->> 'cancellation_notice_days')::integer from public.app_settings s where s.key = 'operations'), 14);
  effective := app.business_today() + notice_days;

  prev := app.begin_internal('carrier_lifecycle');
  update public.carriers
  set cancellation_requested_at = now(), cancellation_requested_by = auth.uid(),
      cancellation_effective_date = effective, cancellation_reason = trim(p_reason)
  where id = p_carrier_id;

  insert into public.support_requests (carrier_id, category, subject, body)
  values (p_carrier_id, 'cancellation', 'Dispatch service cancellation request', trim(p_reason));

  insert into public.tasks (title, description, kind, carrier_id, priority, source, dedupe_key)
  values ('Cancellation requested: ' || c.legal_name,
          format('Effective %s under the service agreement notice period. Confirm open loads and final statement.', effective),
          'support', p_carrier_id, 'high', 'system', 'cancellation:' || p_carrier_id::text || ':' || effective::text);
  perform app.end_internal(prev);
  return effective;
end
$$;

-- -----------------------------------------------------------------------------
-- Dashboard metrics (SECURITY INVOKER: RLS scopes dispatchers to their carriers)
-- -----------------------------------------------------------------------------
create or replace function public.get_dashboard_metrics(p_week_start date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  tz text := app.business_timezone();
  week_start date := coalesce(p_week_start, date_trunc('week', now() at time zone tz)::date);
  week_from timestamptz := (week_start::timestamp at time zone tz);
  week_to timestamptz := ((week_start + 7)::timestamp at time zone tz);
  result jsonb;
begin
  if not app.is_staff() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  with
  completed as (
    select fs.* from public.fee_snapshots fs where fs.statement_week = week_start
  ),
  flat_fees as (
    select coalesce(sum(li.amount), 0) as amount
    from public.statement_line_items li
    join public.weekly_statements s on s.id = li.statement_id
    where s.period_start = week_start and s.status <> 'void' and li.line_type = 'flat_weekly_fee' and not li.voided
  ),
  miles as (
    select coalesce(sum(loaded_miles), 0) as loaded, coalesce(sum(deadhead_miles), 0) as deadhead,
           coalesce(sum(gross_rate), 0) as gross
    from completed where basis = 'completed'
  ),
  active_loads as (
    select l.truck_id from public.loads l
    where l.status in ('booked', 'dispatched', 'at_pickup', 'loaded', 'in_transit') and l.truck_id is not null
  )
  select jsonb_build_object(
    'week_start', week_start,
    'active_carriers', (select count(*) from public.carriers c where c.status = 'active' and c.deleted_at is null),
    'onboarding_carriers', (select count(*) from public.carriers c where c.status = 'onboarding' and c.deleted_at is null),
    'active_trucks', (
      select count(*) from public.trucks t join public.carriers c on c.id = t.carrier_id
      where t.status = 'active' and c.status = 'active'),
    'trucks_available_now', (
      select count(distinct da.truck_id) from public.driver_availability da
      where da.status = 'available' and da.truck_id is not null
        and da.available_from <= now() and (da.available_until is null or da.available_until > now())
        and da.truck_id not in (select truck_id from active_loads)),
    'loads_booked_this_week', (
      select count(*) from public.loads l where l.booked_at >= week_from and l.booked_at < week_to),
    'loads_in_progress', (select count(*) from active_loads),
    'loads_awaiting_carrier', (select count(*) from public.loads l where l.status = 'proposed'),
    'carrier_gross_revenue', (select coalesce(sum(total_revenue), 0) from completed),
    'dispatch_fees_earned', (select coalesce(sum(dispatch_fee), 0) from completed) + (select amount from flat_fees),
    'avg_loaded_rate_per_mile', (select case when loaded > 0 then round(gross / loaded, 2) end from miles),
    'avg_all_in_rate_per_mile', (select case when loaded + deadhead > 0 then round(gross / (loaded + deadhead), 2) end from miles),
    'loaded_miles', (select loaded from miles),
    'deadhead_miles', (select deadhead from miles),
    'deadhead_percentage', (select case when loaded + deadhead > 0 then round(100 * deadhead / (loaded + deadhead), 1) end from miles),
    'outstanding_invoices_count', (select count(*) from public.invoices i where i.status in ('open', 'uncollectible')),
    'outstanding_invoices_amount', (select coalesce(sum(i.balance_due), 0) from public.invoices i where i.status in ('open', 'uncollectible')),
    'overdue_invoices_count', (select count(*) from public.invoices i where i.status = 'open' and i.due_date < app.business_today()),
    'documents_expiring_30_days', (
      select count(*) from public.documents d
      where d.status = 'accepted' and d.deleted_at is null and d.expires_on is not null
        and d.expires_on <= app.business_today() + 30),
    'applications_pending_review', (
      select count(*) from public.carrier_applications a where a.status in ('submitted', 'under_review'))
  ) into result;
  return result;
end
$$;

revoke execute on function public.get_carrier_onboarding(uuid) from public, anon;
revoke execute on function public.approve_application(uuid, text, uuid, text) from public, anon;
revoke execute on function public.accept_organization_invitation(text) from public, anon;
revoke execute on function public.request_carrier_cancellation(uuid, text) from public, anon;
revoke execute on function public.get_dashboard_metrics(date) from public, anon;
grant execute on function public.get_carrier_onboarding(uuid) to authenticated;
grant execute on function public.approve_application(uuid, text, uuid, text) to authenticated, service_role;
grant execute on function public.accept_organization_invitation(text) to authenticated;
grant execute on function public.request_carrier_cancellation(uuid, text) to authenticated;
grant execute on function public.get_dashboard_metrics(date) to authenticated;
