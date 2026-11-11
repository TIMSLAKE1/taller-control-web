import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hasDiagnosticFee, orderBalance, orderChargeTotal, orderPaidTotal, proposedOrderTotal,
  repairEstimateTotal, scheduledDeliveries, summarizeEarnings, validateOrderFinancials,
  validatePaymentBalance
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

test('la cuota de diagnóstico se conserva en $100 y la reparación autorizada se suma solo una vez', async () => {
  const { applyApprovalDecision } = await import('./approval.js');
  const diagnosis = order({ status: 'Aprobación', diagnostic_fee: 100, repair_estimate_total: 850, authorized_repair_total: 0, estimate_total: 950, total_charge: 100 });
  const diagnosticPayment = payment({ amount: 100 });
  assert.equal(hasDiagnosticFee(diagnosis), true);
  assert.equal(repairEstimateTotal(diagnosis), 850);
  assert.equal(proposedOrderTotal(diagnosis), 950);
  assert.equal(orderChargeTotal(diagnosis), 100);
  assert.equal(orderBalance(diagnosis, [diagnosticPayment]), 0);
  const approved = applyApprovalDecision(diagnosis, true);
  assert.equal(approved.status, 'En servicio');
  assert.equal(approved.total_charge, 950);
  assert.equal(orderPaidTotal(approved.id, [diagnosticPayment]), 100);
  assert.equal(orderBalance(approved, [diagnosticPayment]), 850);
  const earnings = summarizeEarnings({
    orders: [approved], payments: [diagnosticPayment], expenses: [{ amount: 25 }], now: new Date(2026, 10, 11)
  });
  assert.deepEqual(earnings, { totalCollected: 100, collectedThisMonth: 100, receivable: 850, totalExpenses: 25, cashNet: 75 });
  const repeated = applyApprovalDecision(approved, true);
  assert.equal(repeated.total_charge, 950);
  assert.equal(orderBalance(repeated, [diagnosticPayment]), 850);
  const decimalQuote = applyApprovalDecision(order({
    status: 'Aprobación', diagnostic_fee: 100.5, repair_estimate_total: 349.25,
    authorized_repair_total: 0, estimate_total: 449.75, total_charge: 100.5
  }), true);
  assert.equal(decimalQuote.total_charge, 449.75);
  assert.equal(orderBalance(decimalQuote, [payment({ amount: 100.5 })]), 349.25);
});

test('rechazo no autoriza extras y los guardas de orden evitan importes inconsistentes o menores que los pagos', async () => {
  const { applyApprovalDecision } = await import('./approval.js');
  const diagnosis = order({ status: 'Aprobación', diagnostic_fee: 100, repair_estimate_total: 250, authorized_repair_total: 0, estimate_total: 350, total_charge: 100 });
  const rejected = applyApprovalDecision(diagnosis, false);
  assert.equal(rejected.status, 'Aprobación');
  assert.equal(rejected.total_charge, 100);
  assert.equal(rejected.authorized_repair_total, 0);
  assert.equal(validateOrderFinancials(rejected, [payment({ amount: 100 })]), '');
  assert.match(validateOrderFinancials(diagnosis, [payment({ amount: 100.01 })]), /menor que los 100\.01 MXN ya abonados/);
  assert.match(validateOrderFinancials({ ...diagnosis, total_charge: 99 }, []), /total vigente/);
  assert.match(validateOrderFinancials({ ...diagnosis, repair_estimate_total: -1 }, []), /Importe de reparación/);
  assert.match(validateOrderFinancials({ ...diagnosis, estimate_total: 351 }, []), /debe ser igual/);
  assert.match(validatePaymentBalance(payment({ amount: 100.01 }), diagnosis, []), /supera el saldo/);
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
