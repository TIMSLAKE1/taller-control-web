create table public.service_order_payments (
  id uuid primary key default extensions.gen_random_uuid(),
  service_order_id text not null references public.service_orders(id) on delete restrict,
  paid_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('Efectivo','Transferencia','Tarjeta','Otro')),
  reference text not null default '' check (length(reference) <= 160),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index service_order_payments_order_idx on public.service_order_payments (service_order_id, paid_on desc);
create index service_order_payments_paid_on_idx on public.service_order_payments (paid_on desc);
create index service_order_payments_created_at_idx on public.service_order_payments (created_at, id);
create index service_order_payments_created_by_idx on public.service_order_payments (created_by);

alter table public.service_order_payments enable row level security;
revoke all on table public.service_order_payments from public, anon, authenticated;
grant select, insert on table public.service_order_payments to authenticated;

create policy service_order_payments_active_technicians_read on public.service_order_payments
  for select to authenticated
  using ((select private.taller_user_is_active()));
create policy service_order_payments_active_technicians_insert on public.service_order_payments
  for insert to authenticated
  with check (
    (select private.taller_user_is_active())
    and created_by = (select auth.uid())
  );

create or replace function private.validate_service_order_payment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_order public.service_orders%rowtype;
  v_total numeric(12,2);
  v_paid numeric(12,2);
begin
  if auth.uid() is null or not private.taller_user_is_active() or new.created_by <> auth.uid() then
    raise exception 'La cuenta no tiene autorización para registrar este cobro.' using errcode = '42501';
  end if;

  select * into v_order
    from public.service_orders
   where id = new.service_order_id
   for update;
  if not found then
    raise exception 'No se encontró la orden relacionada con el cobro.' using errcode = '23503';
  end if;
  if v_order.status = 'Cancelada' then
    raise exception 'No se pueden registrar cobros para una orden cancelada.' using errcode = '23514';
  end if;

  v_total := coalesce(
    nullif(v_order.data_json ->> 'total_charge', '')::numeric,
    nullif(v_order.data_json ->> 'estimate_total', '')::numeric,
    0
  );
  select coalesce(sum(p.amount), 0) into v_paid
    from public.service_order_payments p
   where p.service_order_id = new.service_order_id;
  if new.amount + v_paid > v_total then
    raise exception 'El cobro supera el saldo pendiente de la orden.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_service_order_payment() from public, anon, authenticated;
create trigger service_order_payments_validate_balance
  before insert on public.service_order_payments
  for each row execute function private.validate_service_order_payment();
