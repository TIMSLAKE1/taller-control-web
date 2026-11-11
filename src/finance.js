export const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Otro'];
export const DEFAULT_DIAGNOSTIC_FEE = 100;
export const MAX_ORDER_AMOUNT = 9999999999.99;

const asMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : 0;
};
const validAmount = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= MAX_ORDER_AMOUNT;

export function hasDiagnosticFee(order) {
  return Number.isFinite(Number(order?.diagnostic_fee)) && Number(order.diagnostic_fee) > 0;
}

export function diagnosticFee(order) {
  return hasDiagnosticFee(order) ? asMoney(order.diagnostic_fee) : 0;
}

export function repairEstimateTotal(order) {
  if (!hasDiagnosticFee(order)) return 0;
  if (order?.repair_estimate_total != null) return Math.max(0, asMoney(order.repair_estimate_total));
  return Math.max(0, asMoney(Number(order?.estimate_total || 0) - diagnosticFee(order)));
}

export function proposedOrderTotal(order) {
  if (hasDiagnosticFee(order)) return asMoney(diagnosticFee(order) + repairEstimateTotal(order));
  return Math.max(0, asMoney(order?.estimate_total ?? order?.total_charge ?? 0));
}

export function orderChargeTotal(order) {
  if (order?.total_charge != null) return Math.max(0, asMoney(order.total_charge));
  if (hasDiagnosticFee(order)) return asMoney(diagnosticFee(order) + Number(order.authorized_repair_total || 0));
  return Math.max(0, asMoney(order?.estimate_total ?? 0));
}

export function orderPaidTotal(orderId, payments = []) {
  return asMoney(payments.filter((payment) => payment.service_order_id === orderId)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
}

export function orderBalance(order, payments = []) {
  return Math.max(0, asMoney(orderChargeTotal(order) - orderPaidTotal(order?.id, payments)));
}

// Treat approval as setting the order's total, not adding a second $100 payment.
// This remains safe if the accepted quote is processed more than once.
export function withApprovedQuote(order) {
  if (!hasDiagnosticFee(order)) return { ...order };
  const approvedRepair = repairEstimateTotal(order);
  return {
    ...order,
    authorized_repair_total: approvedRepair,
    total_charge: asMoney(diagnosticFee(order) + approvedRepair)
  };
}

export function validateOrderFinancials(order, payments = []) {
  if (!order || typeof order !== 'object') return 'La orden no es válida.';
  for (const [label, value] of [
    ['Cuota de diagnóstico', order.diagnostic_fee],
    ['Importe de reparación', order.repair_estimate_total],
    ['Importe de reparación autorizado', order.authorized_repair_total],
    ['Estimación', order.estimate_total],
    ['Total a cobrar', order.total_charge]
  ]) {
    if (value == null) continue;
    if (!validAmount(value)) return `${label}: captura un importe entre $0.00 y $${MAX_ORDER_AMOUNT.toFixed(2)} MXN.`;
  }
  if (hasDiagnosticFee(order)) {
    const expectedEstimate = asMoney(diagnosticFee(order) + repairEstimateTotal(order));
    if (expectedEstimate > MAX_ORDER_AMOUNT || asMoney(order.estimate_total) !== expectedEstimate) {
      return 'La estimación debe ser igual a la cuota de diagnóstico más la reparación propuesta.';
    }
    const authorizedRepair = asMoney(order.authorized_repair_total || 0);
    const expectedCharge = asMoney(diagnosticFee(order) + authorizedRepair);
    if (order.total_charge != null && asMoney(order.total_charge) !== expectedCharge) {
      return 'El total vigente debe conservar la cuota de diagnóstico y la reparación aprobada.';
    }
  }
  const paid = orderPaidTotal(order.id, payments);
  if (orderChargeTotal(order) < paid) return `El total no puede ser menor que los ${paid.toFixed(2)} MXN ya abonados.`;
  return '';
}

export function eligiblePaymentOrders(orders = []) {
  return orders.filter((order) => order && order.status !== 'Cancelada');
}

export function scheduledDeliveries(orders = [], fromDate = '0000-01-01', toDate = '9999-12-31') {
  return orders.filter((order) => {
    const date = String(order?.estimated_ready_at || '').slice(0, 10);
    return date && date >= fromDate && date <= toDate && !['Completa', 'Cancelada'].includes(order.status);
  }).sort((a, b) => String(a.estimated_ready_at).localeCompare(String(b.estimated_ready_at))
    || String(a.order_number || '').localeCompare(String(b.order_number || '')));
}

export function summarizeEarnings({ orders = [], payments = [], expenses = [], now = new Date() } = {}) {
  const totalCollected = asMoney(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const collectedThisMonth = asMoney(payments.filter((payment) => String(payment.paid_on || '').slice(0, 7) === monthKey)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  const receivable = asMoney(eligiblePaymentOrders(orders).reduce((sum, order) => sum + orderBalance(order, payments), 0));
  const totalExpenses = asMoney(expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0));
  return { totalCollected, collectedThisMonth, receivable, totalExpenses, cashNet: asMoney(totalCollected - totalExpenses) };
}

export function validatePaymentFields(payment = {}) {
  const amount = Number(payment.amount);
  const date = String(payment.paid_on || '');
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf())
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (typeof payment.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(payment.id)) return 'Identificador de cobro inválido.';
  if (typeof payment.service_order_id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(payment.service_order_id)) return 'Selecciona una orden válida para el cobro.';
  if (!validDate) return 'Selecciona una fecha válida para el cobro.';
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_ORDER_AMOUNT) return 'El importe del cobro debe ser mayor que cero y no exceder el límite permitido.';
  if (!PAYMENT_METHODS.includes(payment.method)) return 'Selecciona un método de pago válido.';
  if (String(payment.reference || '').length > 160) return 'La nota del cobro no puede superar 160 caracteres.';
  return '';
}

export function validatePaymentBalance(payment, order, previousPayments = []) {
  const fieldError = validatePaymentFields(payment);
  if (fieldError) return fieldError;
  if (!order || order.id !== payment.service_order_id) return 'No se encontró la orden relacionada con el cobro.';
  if (order.status === 'Cancelada') return 'No se pueden registrar cobros para una orden cancelada.';
  const balance = orderBalance(order, previousPayments);
  if (asMoney(payment.amount) > balance) return balance > 0
    ? `El cobro supera el saldo pendiente de ${balance.toFixed(2)} MXN.`
    : 'La orden no tiene saldo pendiente. Revisa el total a cobrar antes de registrar otro pago.';
  return '';
}
