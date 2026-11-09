const cleanText = (value, limit = 500) => String(value ?? '').trim().slice(0, limit);
const emailPattern = /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/;

export function buildApprovalMessage(order = {}) {
  const customer = order.customer || {};
  const vehicle = order.vehicle || {};
  const name = cleanText(customer.name, 100) || 'cliente';
  const vehicleName = [vehicle.make, vehicle.model, vehicle.year].map((value) => cleanText(value, 80)).filter(Boolean).join(' ') || 'vehículo';
  const plate = cleanText(vehicle.plate, 30);
  const work = cleanText(order.work_scope, 500) || cleanText(order.reason, 100) || 'Por definir';
  const estimate = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(Number(order.estimate_total || 0));
  const note = cleanText(order.approval_note, 500);
  return [
    `Hola ${name}, te compartimos la propuesta del taller para que la revises.`,
    `Orden: ${cleanText(order.order_number, 80) || 'Sin folio'}.`,
    `Vehículo: ${vehicleName}${plate ? ` · placas ${plate}` : ''}.`,
    `Trabajo propuesto: ${work}.`,
    `Estimación: ${estimate} MXN.`,
    'Por favor responde si autorizas el trabajo propuesto o si solicitas cambios.',
    note ? `Nota adicional: ${note}` : ''
  ].filter(Boolean).join('\n');
}

export function buildEmailDraftUrl(order = {}) {
  const email = cleanText(order.customer?.email, 254);
  if (!emailPattern.test(email)) return null;
  const subject = `Revisión de orden ${cleanText(order.order_number, 80) || ''}`.trim();
  const recipient = encodeURIComponent(email).replace(/%40/gi, '@');
  return `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildApprovalMessage(order))}`;
}

export function buildWhatsAppDraftUrl(order = {}) {
  const rawPhone = cleanText(order.customer?.phone, 40).replace(/[()\s.-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(rawPhone)) return null;
  const phone = rawPhone.replace(/\D/g, '');
  return `https://wa.me/${phone}?text=${encodeURIComponent(buildApprovalMessage(order))}`;
}
