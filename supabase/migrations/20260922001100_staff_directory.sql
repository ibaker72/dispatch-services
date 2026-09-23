-- =============================================================================
-- Staff directory for assignee pickers.
-- user_roles is readable only by admins (and each user's own rows), so
-- dispatchers get this narrow, read-only view of active staff instead.
-- =============================================================================
create or replace function public.list_staff_members()
returns table (user_id uuid, full_name text, email text, roles public.app_role[], grants_all_carriers boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.email::text, array_agg(r.role order by r.role), bool_or(r.grants_all_carriers)
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  where r.revoked_at is null and p.deactivated_at is null and app.is_staff()
  group by p.id, p.full_name, p.email
  order by coalesce(p.full_name, p.email::text)
$$;
revoke all on function public.list_staff_members() from public, anon;
grant execute on function public.list_staff_members() to authenticated;
