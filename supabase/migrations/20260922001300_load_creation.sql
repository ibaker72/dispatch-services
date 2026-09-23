-- =============================================================================
-- Atomic load creation (load + stops + vehicles). SECURITY INVOKER, so the
-- caller's RLS policies and the load guard triggers apply unchanged: the
-- carrier must be active and contracted, and the caller must have access.
-- =============================================================================
create or replace function public.create_load(p_load jsonb, p_stops jsonb, p_vehicles jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  l public.loads;
  new_id uuid;
  stop jsonb;
  vehicle jsonb;
  seq integer := 0;
  pickup_id uuid;
  delivery_id uuid;
begin
  if jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) < 2 then
    raise exception 'a load needs at least one pickup and one delivery stop' using errcode = '23514', hint = 'stops_required';
  end if;
  l := jsonb_populate_record(null::public.loads, p_load);

  insert into public.loads (
    carrier_id, dispatcher_id, broker_id, broker_name, broker_mc_number, broker_contact_name, broker_contact_phone,
    broker_contact_email, broker_load_number, equipment_type, commodity, weight_lbs, gross_rate, loaded_miles, deadhead_miles
  ) values (
    l.carrier_id, l.dispatcher_id, l.broker_id, l.broker_name, l.broker_mc_number, l.broker_contact_name, l.broker_contact_phone,
    l.broker_contact_email, l.broker_load_number, l.equipment_type, l.commodity, l.weight_lbs, l.gross_rate, l.loaded_miles,
    coalesce(l.deadhead_miles, 0)
  ) returning id into new_id;

  for stop in select value from jsonb_array_elements(p_stops) loop
    seq := seq + 1;
    insert into public.load_stops (
      load_id, carrier_id, sequence, stop_type, facility_name, address_line1, city, state, postal_code,
      appointment_type, window_start, window_end, contact_name, contact_phone, instructions
    ) values (
      new_id, l.carrier_id, seq, stop ->> 'stop_type', stop ->> 'facility_name', stop ->> 'address_line1',
      stop ->> 'city', upper(stop ->> 'state'), stop ->> 'postal_code', coalesce(stop ->> 'appointment_type', 'window'),
      (stop ->> 'window_start')::timestamptz, (stop ->> 'window_end')::timestamptz,
      stop ->> 'contact_name', stop ->> 'contact_phone', stop ->> 'instructions'
    );
  end loop;

  for vehicle in select value from jsonb_array_elements(coalesce(p_vehicles, '[]'::jsonb)) loop
    select id into pickup_id from public.load_stops where load_id = new_id and sequence = (vehicle ->> 'pickup_sequence')::integer;
    select id into delivery_id from public.load_stops where load_id = new_id and sequence = (vehicle ->> 'delivery_sequence')::integer;
    insert into public.load_vehicles (
      load_id, carrier_id, pickup_stop_id, delivery_stop_id, vin, year, make, model, vehicle_type, operable,
      auction_or_dealer_name, lot_number, pickup_contact_name, pickup_contact_phone, delivery_contact_name,
      delivery_contact_phone, keys_title_notes
    ) values (
      new_id, l.carrier_id, pickup_id, delivery_id, vehicle ->> 'vin', (vehicle ->> 'year')::smallint,
      vehicle ->> 'make', vehicle ->> 'model', coalesce(vehicle ->> 'vehicle_type', 'other'),
      coalesce((vehicle ->> 'operable')::boolean, true), vehicle ->> 'auction_or_dealer_name', vehicle ->> 'lot_number',
      vehicle ->> 'pickup_contact_name', vehicle ->> 'pickup_contact_phone', vehicle ->> 'delivery_contact_name',
      vehicle ->> 'delivery_contact_phone', vehicle ->> 'keys_title_notes'
    );
  end loop;

  if not exists (select 1 from public.load_stops where load_id = new_id and stop_type = 'pickup')
     or not exists (select 1 from public.load_stops where load_id = new_id and stop_type = 'delivery') then
    raise exception 'a load needs at least one pickup and one delivery stop' using errcode = '23514', hint = 'stops_required';
  end if;
  return new_id;
end
$$;
revoke all on function public.create_load(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_load(jsonb, jsonb, jsonb) to authenticated;
