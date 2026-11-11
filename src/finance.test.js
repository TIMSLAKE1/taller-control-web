import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  orderBalance, orderChargeTotal, orderPaidTotal, scheduledDeliveries,
  summarizeEarnings, validatePaymentBalance
} from './finance.js';

const order = (overrides = {}) => ({
  id: 'order-0001', order_number: 'OS-0001', status: 'En servicio', estimate_total: 1000,
  ...overrides
});
const payment = (overrides = {}) => ({
  id: 'pay-00001', service_order_id: 'order-0001', paid_on: '2026-11-11', amount: 250,
  method: 'Efectivo', reference: '', ...overrides
});

test('calcula cobros y saldo usando centavos y el total final antes de la estimación', () => {
  const payments = [payment({ amount: 99.99 }), payment({ id: 'pay-00002', amount: 0.01 })];
  assert.equal(orderChargeTotal(order({ total_charge: 400 })), 400);
  assert.equal(orderPaidTotal('order-0001', payments), 100);
  assert.equal(orderBalance(order({ total_charge: 400 }), payments), 300);
  assert.equal(orderBalance(order({ total_charge: 100 }), [payment({ amount: 100.005 })]), 0);
});

test('resumen diferencia cobros del mes, saldo y neto de caja', () => {
  const summary = summarizeEarnings({
    now: new Date(2026, 10, 11),
    orders: [order({ total_charge: 1000 }), order({ id: 'order-0002', status: 'Completa', total_charge: 300 }), order({ id: 'order-0003', status: 'Cancelada', total_charge: 500 })],
    payments: [payment({ amount: 250 }), payment({ id: 'pay-00002', paid_on: '2026-10-31', amount: 50 })],
    expenses: [{ amount: 75.25 }]
  });
  assert.deepEqual(summary, { totalCollected: 300, collectedThisMonth: 250, receivable: 1000, totalExpenses: 75.25, cashNet: 224.75 });
});

test('calendario filtra fechas, órdenes cerradas y ordena próximas entregas', () => {
  const orders = [
    order({ id: 'order-0002', estimated_ready_at: '2026-11-13' }),
    order({ id: 'order-0003', status: 'Completa', estimated_ready_at: '2026-11-12' }),
    order({ id: 'order-0004', status: 'Cancelada', estimated_ready_at: '2026-11-12' }),
    order({ id: 'order-0005', estimated_ready_at: '2026-11-12' }),
    order({ id: 'order-0006', estimated_ready_at: '2026-11-20' })
  ];
  assert.deepEqual(scheduledDeliveries(orders, '2026-11-12', '2026-11-15').map((item) => item.id), ['order-0005', 'order-0002']);
});

test('valida cobro parcial, evita exceder saldo y bloquea órdenes canceladas', () => {
  const existing = [payment({ amount: 700 })];
  assert.equal(validatePaymentBalance(payment({ amount: 300 }), order({ total_charge: 1000 }), existing), '');
  assert.match(validatePaymentBalance(payment({ amount: 300.01 }), order({ total_charge: 1000 }), existing), /supera el saldo/);
  assert.match(validatePaymentBalance(payment(), order({ status: 'Cancelada' }), []), /cancelada/);
  assert.match(validatePaymentBalance(payment({ paid_on: '2026-13-40' }), order(), []), /fecha válida/);
});
