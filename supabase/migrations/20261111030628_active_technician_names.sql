-- Expose only names needed for service-order assignment; never expose profile emails.
create or replace function public.get_active_technician_names()
returns table (display_name text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or not private.taller_user_is_active() then
    raise exception 'Inicia sesión con una cuenta de técnico autorizada.' using errcode = '42501';
  end if;

  return query
    select distinct p.display_name
      from public.profiles as p
     where p.active = true
       and p.role = 'mechanic'
     order by p.display_name;
end;
$$;

revoke all on function public.get_active_technician_names() from public, anon;
grant execute on function public.get_active_technician_names() to authenticated;
