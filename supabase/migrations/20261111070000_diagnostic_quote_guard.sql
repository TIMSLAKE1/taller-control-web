-- Preserve the diagnosis/repair quote arithmetic and never let an order total
-- fall below money already recorded as received. This migration is repository-only;
-- do not apply it to the live Supabase project as part of this change.
create or replace function private.validate_service_order_financials()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_diagnostic numeric := 0;
  v_repair numeric := 0;
  v_authorized_repair numeric := 0;
  v_estimate numeric := 0;
  v_charge numeric := 0;
  v_paid numeric := 0;
  v_field text;
begin
  foreach v_field in array array[
    'diagnostic_fee', 'repair_estimate_total', 'authorized_repair_total',
    'estimate_total', 'total_charge'
  ] loop
    if new.data_json ? v_field
       and jsonb_typeof(new.data_json -> v_field) not in ('number', 'null') then
      raise exception 'El importe % debe ser numérico.', v_field using errcode = '23514';
    end if;
  end loop;

  v_diagnostic := coalesce(nullif(new.data_json ->> 'diagnostic_fee', '')::numeric, 0);
  v_authorized_repair := coalesce(nullif(new.data_json ->> 'authorized_repair_total', '')::numeric, 0);
  v_estimate := coalesce(nullif(new.data_json ->> 'estimate_total', '')::numeric, 0);
  v_repair := coalesce(nullif(new.data_json ->> 'repair_estimate_total', '')::numeric,
    case when v_diagnostic > 0 then greatest(0, v_estimate - v_diagnostic) else 0 end);
  v_charge := coalesce(nullif(new.data_json ->> 'total_charge', '')::numeric,
    case when v_diagnostic > 0 then v_diagnostic + v_authorized_repair else v_estimate end, 0);

  if v_diagnostic < 0 or v_repair < 0 or v_authorized_repair < 0
     or v_estimate < 0 or v_charge < 0
     or greatest(v_diagnostic, v_repair, v_authorized_repair, v_estimate, v_charge) > 9999999999.99 then
    raise exception 'Los importes de la orden deben estar entre $0.00 y $9999999999.99 MXN.' using errcode = '23514';
  end if;

  if v_diagnostic > 0 then
    if v_diagnostic + v_repair > 9999999999.99
       or v_estimate <> v_diagnostic + v_repair then
      raise exception 'La estimación debe sumar diagnóstico más reparación propuesta.' using errcode = '23514';
    end if;
    if v_charge <> v_diagnostic + v_authorized_repair then
      raise exception 'El total vigente debe conservar diagnóstico más reparación autorizada.' using errcode = '23514';
    end if;
  end if;

  select coalesce(sum(p.amount), 0) into v_paid
    from public.service_order_payments p
   where p.service_order_id = new.id;
  if v_charge < v_paid then
    raise exception 'El total no puede ser menor que los pagos ya registrados.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_service_order_financials() from public, anon, authenticated;

drop trigger if exists service_orders_validate_financials on public.service_orders;
create trigger service_orders_validate_financials
  before insert or update of data_json on public.service_orders
  for each row execute function private.validate_service_order_financials();
