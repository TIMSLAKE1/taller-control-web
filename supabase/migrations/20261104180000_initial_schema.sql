-- Taller Control: estructura inicial multi-taller con RLS.
-- Ejecutar una sola vez en un proyecto Supabase nuevo.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.workshops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.workshop_members (
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','staff')),
  created_at timestamptz not null default now(),
  primary key (workshop_id, user_id)
);

create or replace function public.is_workshop_member(target_workshop uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.workshop_members m where m.workshop_id = target_workshop and m.user_id = auth.uid()) $$;

create or replace function public.is_workshop_admin(target_workshop uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.workshop_members m where m.workshop_id = target_workshop and m.user_id = auth.uid() and m.role in ('owner','admin')) $$;

revoke all on function public.is_workshop_member(uuid) from public;
revoke all on function public.is_workshop_admin(uuid) from public;
grant execute on function public.is_workshop_member(uuid) to authenticated;
grant execute on function public.is_workshop_admin(uuid) to authenticated;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  full_name text not null,
  phone text not null,
  city text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workshop_id)
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  customer_id uuid not null,
  plate text not null,
  vin text,
  make text not null,
  model text not null,
  year integer,
  color text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workshop_id),
  unique (workshop_id, plate),
  foreign key (customer_id, workshop_id) references public.customers(id, workshop_id) on delete restrict
);

create table if not exists public.service_orders (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  order_number text not null,
  customer_id uuid not null,
  vehicle_id uuid not null,
  received_at timestamptz not null default now(),
  reason text not null default 'Diagnóstico',
  technician text,
  failure_summary text,
  reported_issue text,
  status text not null default 'Borrador' check (status in ('Borrador','Inspección','Aprobación','En servicio','Completa','Cancelada')),
  odometer integer,
  fuel_level text,
  physical_notes text,
  inspection jsonb not null default '{}'::jsonb,
  inventory jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  work_scope text,
  estimate_total numeric(12,2) not null default 0 check (estimate_total >= 0),
  approval_status text not null default 'not_requested' check (approval_status in ('not_requested','pending','approved','changes_requested')),
  approval_channel text,
  signature_provider text,
  approval_note text,
  approval_recorded_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workshop_id, order_number),
  foreign key (customer_id, workshop_id) references public.customers(id, workshop_id) on delete restrict,
  foreign key (vehicle_id, workshop_id) references public.vehicles(id, workshop_id) on delete restrict
);

create table if not exists public.shop_expenses (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  expense_date date not null default current_date,
  category text not null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  service_order_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (service_order_id, workshop_id) references public.service_orders(id, workshop_id) on delete no action
);

create table if not exists public.service_order_events (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  service_order_id uuid not null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (service_order_id, workshop_id) references public.service_orders(id, workshop_id) on delete cascade
);

create index if not exists service_orders_workshop_received_idx on public.service_orders(workshop_id, received_at desc);
create index if not exists service_orders_workshop_status_idx on public.service_orders(workshop_id, status);
create index if not exists shop_expenses_workshop_date_idx on public.shop_expenses(workshop_id, expense_date desc);
create index if not exists vehicles_workshop_plate_idx on public.vehicles(workshop_id, plate);

alter table public.workshops enable row level security;
alter table public.workshop_members enable row level security;
alter table public.customers enable row level security;
alter table public.vehicles enable row level security;
alter table public.service_orders enable row level security;
alter table public.shop_expenses enable row level security;
alter table public.service_order_events enable row level security;

drop policy if exists workshops_read_member on public.workshops;
create policy workshops_read_member on public.workshops for select to authenticated using (created_by = auth.uid() or public.is_workshop_member(id));
drop policy if exists workshops_create_self on public.workshops;
create policy workshops_create_self on public.workshops for insert to authenticated with check (created_by = auth.uid());
drop policy if exists workshops_admin_update on public.workshops;
create policy workshops_admin_update on public.workshops for update to authenticated using (public.is_workshop_admin(id)) with check (public.is_workshop_admin(id));
drop policy if exists workshops_admin_delete on public.workshops;
create policy workshops_admin_delete on public.workshops for delete to authenticated using (public.is_workshop_admin(id));

drop policy if exists workshop_members_read_self_or_admin on public.workshop_members;
create policy workshop_members_read_self_or_admin on public.workshop_members for select to authenticated using (user_id = auth.uid() or public.is_workshop_admin(workshop_id));
drop policy if exists workshop_members_add_self_or_admin on public.workshop_members;
create policy workshop_members_add_self_or_admin on public.workshop_members for insert to authenticated with check (
  (user_id = auth.uid() and exists (select 1 from public.workshops w where w.id = workshop_id and w.created_by = auth.uid()))
  or public.is_workshop_admin(workshop_id)
);
drop policy if exists workshop_members_admin_update on public.workshop_members;
create policy workshop_members_admin_update on public.workshop_members for update to authenticated using (public.is_workshop_admin(workshop_id)) with check (public.is_workshop_admin(workshop_id));
drop policy if exists workshop_members_admin_delete on public.workshop_members;
create policy workshop_members_admin_delete on public.workshop_members for delete to authenticated using (public.is_workshop_admin(workshop_id));

-- Every operational table is isolated by a membership check in both USING and WITH CHECK.
drop policy if exists customers_member_access on public.customers;
create policy customers_member_access on public.customers for all to authenticated using (public.is_workshop_member(workshop_id)) with check (public.is_workshop_member(workshop_id));
drop policy if exists vehicles_member_access on public.vehicles;
create policy vehicles_member_access on public.vehicles for all to authenticated using (public.is_workshop_member(workshop_id)) with check (public.is_workshop_member(workshop_id));
drop policy if exists service_orders_member_access on public.service_orders;
create policy service_orders_member_access on public.service_orders for all to authenticated using (public.is_workshop_member(workshop_id)) with check (public.is_workshop_member(workshop_id));
drop policy if exists shop_expenses_member_access on public.shop_expenses;
create policy shop_expenses_member_access on public.shop_expenses for all to authenticated using (public.is_workshop_member(workshop_id)) with check (public.is_workshop_member(workshop_id));
drop policy if exists service_order_events_member_access on public.service_order_events;
create policy service_order_events_member_access on public.service_order_events for all to authenticated using (public.is_workshop_member(workshop_id)) with check (public.is_workshop_member(workshop_id));

-- Bucket privado; el primer segmento de cada objeto es el UUID del taller.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workshop-evidence', 'workshop-evidence', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists workshop_evidence_read on storage.objects;
create policy workshop_evidence_read on storage.objects for select to authenticated using (bucket_id = 'workshop-evidence' and public.is_workshop_member((storage.foldername(name))[1]::uuid));
drop policy if exists workshop_evidence_add on storage.objects;
create policy workshop_evidence_add on storage.objects for insert to authenticated with check (bucket_id = 'workshop-evidence' and public.is_workshop_member((storage.foldername(name))[1]::uuid));
drop policy if exists workshop_evidence_update on storage.objects;
create policy workshop_evidence_update on storage.objects for update to authenticated using (bucket_id = 'workshop-evidence' and public.is_workshop_member((storage.foldername(name))[1]::uuid)) with check (bucket_id = 'workshop-evidence' and public.is_workshop_member((storage.foldername(name))[1]::uuid));
drop policy if exists workshop_evidence_delete on storage.objects;
create policy workshop_evidence_delete on storage.objects for delete to authenticated using (bucket_id = 'workshop-evidence' and public.is_workshop_member((storage.foldername(name))[1]::uuid));
