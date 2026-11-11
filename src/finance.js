export const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Otro'];

const asMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : 0;
};

export function orderChargeTotal(order) {
  return Math.max(0, asMoney(order?.total_charge ?? order?.estimate_total ?? 0));
}

export function orderPaidTotal(orderId, payments = []) {
  return asMoney(payments.filter((payment) => payment.service_order_id === orderId)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
}

export function orderBalance(order, payments = []) {
  return Math.max(0, asMoney(orderChargeTotal(order) - orderPaidTotal(order?.id, payments)));
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
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999.99) return 'El importe del cobro debe ser mayor que cero y no exceder el límite permitido.';
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
