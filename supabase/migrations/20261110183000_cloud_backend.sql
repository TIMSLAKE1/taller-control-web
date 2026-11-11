create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.app_settings (
  setting_name text primary key,
  setting_value text not null
);
revoke all on table private.app_settings from public, anon, authenticated;
insert into private.app_settings (setting_name, setting_value)
values ('evidence_limit_bytes', '734003200'), ('bootstrap_manager_email', '')
on conflict (setting_name) do nothing;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (length(display_name) between 1 and 100),
  role text not null default 'mechanic' check (role = 'mechanic'),
  is_manager boolean not null default false,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index profiles_email_lower_idx on public.profiles (lower(email));
create unique index profiles_single_manager_idx on public.profiles (is_manager) where is_manager = true;

create table public.technician_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  email text not null,
  display_name text not null check (length(display_name) between 2 and 100),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz
);
create unique index technician_invitations_pending_email_idx
  on public.technician_invitations (lower(email)) where accepted_at is null;

create table public.service_orders (
  id text primary key check (length(id) between 8 and 80),
  order_number text not null unique check (length(order_number) between 1 and 80),
  received_at timestamptz not null,
  status text not null check (status in ('Borrador','Inspección','Aprobación','En servicio','Completa','Cancelada')),
  customer_name text not null default '',
  vehicle_plate text not null default '',
  data_json jsonb not null check (jsonb_typeof(data_json) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index service_orders_received_idx on public.service_orders (received_at desc);

create table public.shop_expenses (
  id text primary key check (length(id) between 8 and 80),
  expense_date date not null,
  category text not null check (length(category) between 1 and 80),
  description text not null check (length(description) between 1 and 160),
  amount numeric(12,2) not null check (amount > 0),
  service_order_id text references public.service_orders(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index shop_expenses_date_idx on public.shop_expenses (expense_date desc);

create table public.service_order_events (
  id uuid primary key default extensions.gen_random_uuid(),
  service_order_id text not null references public.service_orders(id) on delete cascade,
  event_type text not null check (length(event_type) between 1 and 80),
  details_json jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index service_order_events_order_idx on public.service_order_events (service_order_id, created_at desc);

create table public.evidence_files (
  id uuid primary key default extensions.gen_random_uuid(),
  service_order_id text not null references public.service_orders(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null check (length(original_name) between 1 and 180),
  media_type text not null check (media_type in ('image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif')),
  size integer not null check (size > 0 and size <= 10485760),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index evidence_files_order_idx on public.evidence_files (service_order_id, created_at);

create table public.expense_evidence_files (
  id uuid primary key default extensions.gen_random_uuid(),
  expense_id text not null unique references public.shop_expenses(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null check (length(original_name) between 1 and 180),
  media_type text not null check (media_type in ('image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif')),
  size integer not null check (size > 0 and size <= 10485760),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.taller_user_is_active()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active = true and p.role = 'mechanic'
  );
$$;

create or replace function public.taller_user_is_manager()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active = true and p.role = 'mechanic' and p.is_manager = true
  );
$$;

revoke all on function public.taller_user_is_active() from public, anon;
revoke all on function public.taller_user_is_manager() from public, anon;
grant execute on function public.taller_user_is_active() to authenticated;
grant execute on function public.taller_user_is_manager() to authenticated;

create or replace function public.handle_taller_auth_user_created()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_token text;
  v_invitation_id uuid;
  v_display_name text;
  v_active boolean := false;
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
revoke all on function public.handle_taller_auth_user_created() from public, anon, authenticated;
create trigger taller_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_taller_auth_user_created();

create or replace function public.claim_initial_manager()
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_email text;
  v_confirmed_at timestamptz;
  v_bootstrap_email text;
begin
  if auth.uid() is null then return false; end if;
  select lower(u.email), u.email_confirmed_at
    into v_email, v_confirmed_at
    from auth.users u where u.id = auth.uid();
  if v_email is null or v_confirmed_at is null then return false; end if;
  select lower(s.setting_value) into v_bootstrap_email
    from private.app_settings s where s.setting_name = 'bootstrap_manager_email';
  if v_bootstrap_email is null or v_email <> v_bootstrap_email then return false; end if;
  if exists (select 1 from public.profiles p where p.is_manager = true) then return false; end if;

  update public.profiles
     set active = true, is_manager = true
   where id = auth.uid() and lower(email) = v_email and role = 'mechanic';
  return found;
exception when unique_violation then
  return false;
end;
$$;
revoke all on function public.claim_initial_manager() from public, anon;
grant execute on function public.claim_initial_manager() to authenticated;

create or replace function public.set_technician_active(p_user_id uuid, p_active boolean)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.taller_user_is_manager() then
    raise exception 'Solo el encargado puede administrar técnicos.' using errcode = '42501';
  end if;
  update public.profiles
     set active = p_active
   where id = p_user_id and role = 'mechanic' and is_manager = false;
  if not found then return false; end if;
  return true;
end;
$$;
revoke all on function public.set_technician_active(uuid, boolean) from public, anon;
grant execute on function public.set_technician_active(uuid, boolean) to authenticated;

create or replace function public.get_storage_usage()
returns table (used_bytes bigint, limit_bytes bigint)
language plpgsql stable security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.uid() is null or not public.taller_user_is_active() then
    raise exception 'Inicia sesión con una cuenta autorizada.' using errcode = '42501';
  end if;
  return query
    select
      (coalesce((select sum(f.size)::bigint from public.evidence_files f), 0) +
       coalesce((select sum(f.size)::bigint from public.expense_evidence_files f), 0)) as used_bytes,
      (select s.setting_value::bigint from private.app_settings s where s.setting_name = 'evidence_limit_bytes') as limit_bytes;
end;
$$;
revoke all on function public.get_storage_usage() from public, anon;
grant execute on function public.get_storage_usage() to authenticated;

create or replace function private.enforce_evidence_limit()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_used bigint;
  v_limit bigint;
begin
  perform pg_advisory_xact_lock(38124, 72041);
  select
    coalesce((select sum(f.size)::bigint from public.evidence_files f), 0) +
    coalesce((select sum(f.size)::bigint from public.expense_evidence_files f), 0)
    into v_used;
  select s.setting_value::bigint into v_limit
    from private.app_settings s where s.setting_name = 'evidence_limit_bytes';
  if v_limit is null or v_used + new.size > v_limit then
    raise exception 'Se alcanzó el límite de evidencia configurado para evitar consumir más almacenamiento.' using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_evidence_limit() from public, anon, authenticated;
create trigger evidence_files_limit_guard
  before insert on public.evidence_files
  for each row execute function private.enforce_evidence_limit();
create trigger expense_evidence_files_limit_guard
  before insert on public.expense_evidence_files
  for each row execute function private.enforce_evidence_limit();

create or replace function public.set_taller_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.set_taller_updated_at() from public, anon, authenticated;
create trigger service_orders_updated_at
  before update on public.service_orders
  for each row execute function public.set_taller_updated_at();

alter table public.profiles enable row level security;
alter table public.technician_invitations enable row level security;
alter table public.service_orders enable row level security;
alter table public.shop_expenses enable row level security;
alter table public.service_order_events enable row level security;
alter table public.evidence_files enable row level security;
alter table public.expense_evidence_files enable row level security;

revoke all on table public.profiles, public.technician_invitations, public.service_orders,
  public.shop_expenses, public.service_order_events, public.evidence_files,
  public.expense_evidence_files from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.technician_invitations to authenticated;
grant select, insert, update, delete on public.service_orders to authenticated;
grant select, insert, update, delete on public.shop_expenses to authenticated;
grant select, insert on public.service_order_events to authenticated;
grant select, insert, delete on public.evidence_files, public.expense_evidence_files to authenticated;

grant usage on schema public to authenticated;

create policy profiles_read_self_or_manager on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.taller_user_is_manager());

create policy technician_invitations_manager_all on public.technician_invitations
  for all to authenticated
  using (public.taller_user_is_manager())
  with check (public.taller_user_is_manager());

create policy service_orders_active_technicians_all on public.service_orders
  for all to authenticated
  using (public.taller_user_is_active())
  with check (public.taller_user_is_active());

create policy shop_expenses_active_technicians_all on public.shop_expenses
  for all to authenticated
  using (public.taller_user_is_active())
  with check (public.taller_user_is_active());

create policy service_order_events_active_technicians_all on public.service_order_events
  for all to authenticated
  using (public.taller_user_is_active())
  with check (public.taller_user_is_active());

create policy evidence_files_active_technicians_all on public.evidence_files
  for all to authenticated
  using (public.taller_user_is_active())
  with check (public.taller_user_is_active());

create policy expense_evidence_files_active_technicians_all on public.expense_evidence_files
  for all to authenticated
  using (public.taller_user_is_active())
  with check (public.taller_user_is_active());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'taller-evidencia', 'taller-evidencia', false, 10485760,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy taller_evidence_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'taller-evidencia'
    and public.taller_user_is_active()
    and (
      exists (select 1 from public.evidence_files f where f.storage_path = name)
      or exists (select 1 from public.expense_evidence_files f where f.storage_path = name)
    )
  );

create policy taller_evidence_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'taller-evidencia'
    and public.taller_user_is_active()
    and (
      exists (select 1 from public.evidence_files f where f.storage_path = name and f.created_by = auth.uid())
      or exists (select 1 from public.expense_evidence_files f where f.storage_path = name and f.created_by = auth.uid())
    )
  );

create policy taller_evidence_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'taller-evidencia'
    and public.taller_user_is_active()
    and (
      exists (select 1 from public.evidence_files f where f.storage_path = name)
      or exists (select 1 from public.expense_evidence_files f where f.storage_path = name)
    )
  );
