import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
const approvalView = html.match(/<section class="view" id="view-approval">([\s\S]*?)<\/section>/)?.[1];

test('la aprobación ofrece canales gratuitos y deja el envío en manos del taller', () => {
  assert.ok(approvalView, 'debe existir la vista de aprobación');
  assert.match(html, /id="custEmail" type="email"/);
  assert.match(approvalView, /value="Correo electrónico"/);
  assert.match(approvalView, /value="WhatsApp \(comunicación\)"/);
  assert.match(approvalView, /value="Portal \/ otro"/);
  assert.match(approvalView, /id="prepareApprovalChannel"/);
  assert.match(approvalView, /id="recordApprovalRequest"/);
  assert.match(html, /id="approvalResponseNote"/);
  assert.match(main, /window\.location\.assign\(url\)/);
  assert.match(main, /window\.open\(url, '_blank', 'noopener,noreferrer'\)/);
  assert.match(main, /Confirma que ya compartiste manualmente la propuesta/);
  assert.doesNotMatch(approvalView, /signatureProvider|Proveedor de firma electrónica/);
});

test('la solicitud y respuesta se guardan en la orden local, con sus marcas de tiempo', () => {
  assert.match(main, /order\.approval_requested_at = nowIso\(\)/);
  assert.match(main, /order\.approval_responded_at = nowIso\(\)/);
  assert.match(main, /order\.approval_response_note = \$\('#approvalResponseNote'\)\.value\.trim\(\)/);
  assert.match(main, /await backend\.saveOrder\(order\)/);
  assert.match(main, /approval_requested_at \|\| null/);
  assert.match(main, /approval_responded_at \|\|/);
});
