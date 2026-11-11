-- Keep helper SECURITY DEFINER functions out of the exposed public API schema.
create or replace function private.taller_user_is_active()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active = true and p.role = 'mechanic'
  );
$$;

create or replace function private.taller_user_is_manager()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active = true and p.role = 'mechanic' and p.is_manager = true
  );
$$;

revoke all on function private.taller_user_is_active() from public, anon, authenticated;
revoke all on function private.taller_user_is_manager() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.taller_user_is_active() to authenticated;
grant execute on function private.taller_user_is_manager() to authenticated;

-- Allow Auth account creation only for a valid manager bootstrap email or a live invitation.
create or replace function public.handle_taller_auth_user_created()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, extensions, private
as $$
declare
  v_token text;
  v_invitation_id uuid;
  v_display_name text;
  v_active boolean := false;
  v_bootstrap_email text;
begin
  v_token := new.raw_user_meta_data ->> 'invitation_token';
  if v_token is not null and length(v_token) between 32 and 128 and new.email is not null then
    select i.id, i.display_name
      into v_invitation_id, v_display_name
      from public.technician_invitations i
     where lower(i.email) = lower(new.email)
       and i.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
       and i.accepted_at is null
       and i.expires_at > now()
     for update;
    if found then
      update public.technician_invitations set accepted_at = now() where id = v_invitation_id;
      v_active := true;
    end if;
  end if;

  if not v_active then
    select nullif(lower(s.setting_value), '') into v_bootstrap_email
      from private.app_settings s where s.setting_name = 'bootstrap_manager_email';
    if v_bootstrap_email is null
       or lower(coalesce(new.email, '')) <> v_bootstrap_email
       or exists (select 1 from public.profiles p where p.is_manager = true) then
      raise exception 'Solo se permiten cuentas autorizadas por invitación o el correo de encargado configurado.'
        using errcode = '42501';
    end if;
  end if;

  if v_display_name is null then
    v_display_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'tecnico'), '@', 1));
  end if;
  v_display_name := left(v_display_name, 100);
  insert into public.profiles (id, email, display_name, role, is_manager, active)
  values (new.id, coalesce(new.email, ''), v_display_name, 'mechanic', false, v_active)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Rebind privileged functions and RLS policies to private helpers.
create or replace function public.set_technician_active(p_user_id uuid, p_active boolean)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
  if auth.uid() is null or not private.taller_user_is_manager() then
    raise exception 'Solo el encargado puede administrar técnicos.' using errcode = '42501';
  end if;
  update public.profiles
     set active = p_active
   where id = p_user_id and role = 'mechanic' and is_manager = false;
  if not found then return false; end if;
  return true;
end;
$$;

create or replace function public.get_storage_usage()
returns table (used_bytes bigint, limit_bytes bigint)
language plpgsql stable security definer
set search_path = pg_catalog, public, private, auth
as $$
begin
  if auth.uid() is null or not private.taller_user_is_active() then
    raise exception 'Inicia sesión con una cuenta autorizada.' using errcode = '42501';
  end if;
  return query
    select
      (coalesce((select sum(f.size)::bigint from public.evidence_files f), 0) +
       coalesce((select sum(f.size)::bigint from public.expense_evidence_files f), 0)) as used_bytes,
      (select s.setting_value::bigint from private.app_settings s where s.setting_name = 'evidence_limit_bytes') as limit_bytes;
end;
$$;

-- Re-create the policies using helpers that are not in the exposed public schema.
drop policy if exists profiles_read_self_or_manager on public.profiles;
create policy profiles_read_self_or_manager on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.taller_user_is_manager()));

drop policy if exists technician_invitations_manager_all on public.technician_invitations;
create policy technician_invitations_manager_all on public.technician_invitations
  for all to authenticated
  using ((select private.taller_user_is_manager()))
  with check ((select private.taller_user_is_manager()));

drop policy if exists service_orders_active_technicians_all on public.service_orders;
create policy service_orders_active_technicians_all on public.service_orders
  for all to authenticated
  using ((select private.taller_user_is_active()))
  with check ((select private.taller_user_is_active()));

drop policy if exists shop_expenses_active_technicians_all on public.shop_expenses;
create policy shop_expenses_active_technicians_all on public.shop_expenses
  for all to authenticated
  using ((select private.taller_user_is_active()))
  with check ((select private.taller_user_is_active()));

drop policy if exists service_order_events_active_technicians_all on public.service_order_events;
create policy service_order_events_active_technicians_all on public.service_order_events
  for all to authenticated
  using ((select private.taller_user_is_active()))
  with check ((select private.taller_user_is_active()));

drop policy if exists evidence_files_active_technicians_all on public.evidence_files;
create policy evidence_files_active_technicians_all on public.evidence_files
  for all to authenticated
  using ((select private.taller_user_is_active()))
  with check ((select private.taller_user_is_active()));

drop policy if exists expense_evidence_files_active_technicians_all on public.expense_evidence_files;
create policy expense_evidence_files_active_technicians_all on public.expense_evidence_files
  for all to authenticated
  using ((select private.taller_user_is_active()))
  with check ((select private.taller_user_is_active()));

drop policy if exists taller_evidence_select on storage.objects;
create policy taller_evidence_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'taller-evidencia'
    and (select private.taller_user_is_active())
    and (
      exists (select 1 from public.evidence_files f where f.storage_path = name)
      or exists (select 1 from public.expense_evidence_files f where f.storage_path = name)
    )
  );

drop policy if exists taller_evidence_insert on storage.objects;
create policy taller_evidence_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'taller-evidencia'
    and (select private.taller_user_is_active())
    and (
      exists (select 1 from public.evidence_files f where f.storage_path = name and f.created_by = (select auth.uid()))
      or exists (select 1 from public.expense_evidence_files f where f.storage_path = name and f.created_by = (select auth.uid()))
    )
  );

drop policy if exists taller_evidence_delete on storage.objects;
create policy taller_evidence_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'taller-evidencia'
    and (select private.taller_user_is_active())
    and (
      exists (select 1 from public.evidence_files f where f.storage_path = name)
      or exists (select 1 from public.expense_evidence_files f where f.storage_path = name)
    )
  );

drop function public.taller_user_is_active();
drop function public.taller_user_is_manager();

-- Cover all foreign keys identified by the Supabase performance advisor.
create index if not exists technician_invitations_created_by_idx on public.technician_invitations (created_by);
create index if not exists service_orders_created_by_idx on public.service_orders (created_by);
create index if not exists shop_expenses_service_order_id_idx on public.shop_expenses (service_order_id);
create index if not exists shop_expenses_created_by_idx on public.shop_expenses (created_by);
create index if not exists service_order_events_actor_id_idx on public.service_order_events (actor_id);
create index if not exists evidence_files_created_by_idx on public.evidence_files (created_by);
create index if not exists expense_evidence_files_created_by_idx on public.expense_evidence_files (created_by);
