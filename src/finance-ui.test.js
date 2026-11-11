import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
const supabase = await readFile(new URL('./supabase-backend.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261111050000_service_order_payments.sql', import.meta.url), 'utf8');

test('la recepción captura fecha estimada y el panel muestra calendario de entregas', () => {
  assert.match(html, /id="estimatedReadyAt" type="date"/);
  assert.match(html, /id="deliveryCalendarGrid"/);
  assert.match(html, /id="calendarPrevBtn"/);
  assert.match(main, /estimated_ready_at: \$\('#estimatedReadyAt'\)\.value \|\| null/);
  assert.match(main, /function renderUpcomingCalendar\(\)/);
  assert.match(main, /scheduledDeliveries\(orders, firstKey, lastKey\)/);
});

test('la sección de ganancias registra abonos por orden y mantiene su historial', () => {
  assert.match(html, /data-view="earnings"/);
  assert.match(html, /id="receivablesBody"/);
  assert.match(html, /id="paymentsBody"/);
  assert.match(html, /id="paymentAmount"/);
  assert.match(html, /id="paymentTotal"/);
  assert.match(main, /backend\.savePayment\(payment\)/);
  assert.match(main, /function exportPayments\(\)/);
  assert.match(html, /la aplicación no procesa tarjetas, transferencias ni pagos en línea/i);
});

test('los cobros cloud solo permiten lectura e inserción a técnicos autorizados y no se alteran', () => {
  assert.match(supabase, /from\('service_order_payments'\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /grant select, insert on table public\.service_order_payments to authenticated/i);
  assert.match(migration, /private\.taller_user_is_active\(\)/);
  assert.match(migration, /created_by = \(select auth\.uid\(\)\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /create trigger service_order_payments_validate_balance\s+before insert/i);
  assert.doesNotMatch(migration, /grant\s+(?:all|update|delete)|create policy[^;]+for\s+(?:update|delete)/i);
});
