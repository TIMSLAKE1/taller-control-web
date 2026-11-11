import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyApprovalDecision, buildApprovalMessage, buildEmailDraftUrl, buildWhatsAppDraftUrl } from './approval.js';

const order = {
  order_number: 'OS-0042',
  customer: { name: 'Ana Pérez', email: 'ana+auto@example.mx', phone: '+52 (55) 1234-5678' },
  vehicle: { make: 'Nissan', model: 'Versa', year: '2022', plate: 'ABC-123' },
  reason: 'Reparación',
  work_scope: 'Revisar frenos y cambiar balatas',
  estimate_total: 1850,
  approval_note: 'Avísame si necesitas más detalles.'
};

test('el texto de autorización incluye datos relevantes y codifica caracteres especiales en correo', () => {
  const message = buildApprovalMessage(order);
  assert.match(message, /Hola Ana Pérez/);
  assert.match(message, /OS-0042/);
  assert.match(message, /Nissan Versa 2022/);
  assert.match(message, /Revisar frenos y cambiar balatas/);
  assert.match(message, /1,850/);
  assert.match(message, /Avísame si necesitas más detalles/);

  const url = buildEmailDraftUrl(order);
  assert.ok(url.startsWith('mailto:ana%2Bauto@example.mx?'));
  assert.match(url, /subject=Revisi%C3%B3n%20de%20orden%20OS-0042/);
  assert.match(url, /body=/);
  assert.equal(decodeURIComponent(url.split('body=')[1]).includes('Ana Pérez'), true);
});

test('la cotización separa diagnóstico y reparación; solo un sí registrado autoriza el cargo adicional', () => {
  const diagnosticOrder = {
    ...order, diagnostic_fee: 100, repair_estimate_total: 850,
    authorized_repair_total: 0, estimate_total: 950, total_charge: 100,
    approval_status: 'pending', status: 'Aprobación'
  };
  const message = buildApprovalMessage(diagnosticOrder);
  assert.match(message, /Diagnóstico:.*100/);
  assert.match(message, /Reparación propuesta adicional:.*850/);
  assert.match(message, /Total propuesto:.*950/);
  assert.match(message, /una sola vez/);
  const approved = applyApprovalDecision(diagnosticOrder, true);
  assert.equal(approved.approval_status, 'approved');
  assert.equal(approved.status, 'En servicio');
  assert.equal(approved.total_charge, 950);
  assert.equal(approved.authorized_repair_total, 850);
  const rejected = applyApprovalDecision(diagnosticOrder, false);
  assert.equal(rejected.status, 'Aprobación');
  assert.equal(rejected.total_charge, 100);
  assert.equal(rejected.authorized_repair_total, 0);
});

test('la aprobación de una orden sin diagnóstico conserva el flujo y la estimación anteriores', () => {
  const approved = applyApprovalDecision(order, true);
  assert.equal(approved.status, 'En servicio');
  assert.equal(approved.estimate_total, 1850);
  assert.equal(approved.total_charge, undefined);
});

test('rechaza correo vacío o inválido sin construir un enlace mailto', () => {
  assert.equal(buildEmailDraftUrl({ customer: { email: '' } }), null);
  assert.equal(buildEmailDraftUrl({ customer: { email: 'sin-arroba' } }), null);
  assert.equal(buildEmailDraftUrl({ customer: { email: 'ana@example.mx?cc=otro@example.mx' } }), null);
});

test('WhatsApp usa prefijo internacional y un mensaje prellenado, sin enviarlo', () => {
  const url = buildWhatsAppDraftUrl(order);
  assert.ok(url.startsWith('https://wa.me/525512345678?text='));
  assert.equal(decodeURIComponent(url.split('text=')[1]).includes('OS-0042'), true);
  assert.equal(buildWhatsAppDraftUrl({ customer: { phone: '55 1234 5678' } }), null);
  assert.equal(buildWhatsAppDraftUrl({ customer: { phone: '+52 55 abc' } }), null);
});
