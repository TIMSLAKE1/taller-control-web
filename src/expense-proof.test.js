import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
const db = await readFile(new URL('../server/db.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');
const reports = html.match(/<section class="view" id="view-reports">([\s\S]*?)<\/section>/)?.[1];

test('cada gasto permite adjuntar, abrir y quitar la imagen de su factura o justificante', () => {
  assert.ok(reports, 'debe existir la pantalla de gastos');
  assert.match(reports, /<th>Comprobante<\/th>/);
  assert.match(main, /id="expenseProof" type="file" accept="image\/jpeg/);
  assert.match(main, /id="expenseProofPreview"/);
  assert.match(main, /data-add-expense-proof/);
  assert.match(main, /data-view-expense-proof/);
  assert.match(main, /data-remove-expense-proof/);
  assert.match(main, /MAX_EXPENSE_PROOF_BYTES = 10 \* 1024 \* 1024/);
});

test('las imágenes se guardan localmente y quedan enlazadas al gasto en SQLite', () => {
  assert.match(main, /\$\{STORAGE_PREFIX\}:expense:\$\{expense\.id\}:\$\{uuid\(\)\}/);
  assert.match(main, /putLocalPhoto\(localKey, file\)/);
  assert.match(main, /\/api\/expenses\/\$\{encodeURIComponent\(expense\.id\)\}\/proof/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS expense_evidence_files/);
  assert.match(db, /expense_id TEXT NOT NULL UNIQUE REFERENCES shop_expenses\(id\) ON DELETE CASCADE/);
  assert.match(server, /expense-proofs/);
  assert.match(server, /imageBytesMatch\(bytes, mediaType\)/);
  assert.match(server, /Cache-Control': 'private, no-store'/);
});
