import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
const reportView = html.match(/<section class="view" id="view-reports">([\s\S]*?)<\/section>/)?.[1];

test('Reportes se enfoca en los gastos reales del taller y empieza vacío', () => {
  assert.ok(reportView, 'debe existir la vista de gastos');
  assert.match(reportView, /<h1>Gastos del taller<\/h1>/);
  assert.match(reportView, /id="addExpenseBtn"/);
  assert.match(reportView, /id="expenseKpis"/);
  assert.match(reportView, /id="expensesBody"><\/tbody>/);
  assert.match(reportView, /id="expensesEmpty" hidden/);
  assert.match(reportView, /Exportar CSV/);
  assert.doesNotMatch(reportView, /43,395|5 semanas|cinco semanas|240 horas|Ulises y Jared|presupuesto del proyecto|Supuestos editables/i);
  assert.doesNotMatch(reportView, /data-panel=|panel-budget|panel-schedule/);
});

test('la lógica de gastos no agrega contenido de presupuesto o cronograma de desarrollo', () => {
  assert.doesNotMatch(main, /43,395|panel-budget|panel-schedule|reportTabs|panel-expenses/i);
  assert.match(main, /const total = expenses\.reduce/);
});
