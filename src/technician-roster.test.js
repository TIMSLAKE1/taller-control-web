import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { normalizeTechnicianNames } from './technician-roster.js';

const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
const backend = await readFile(new URL('./supabase-backend.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261111030628_active_technician_names.sql', import.meta.url), 'utf8');

test('normaliza, ordena y deduplica nombres para el selector', () => {
  assert.deepEqual(normalizeTechnicianNames([
    { display_name: '  Ana   López ' },
    { display_name: 'Zoe Ruiz' },
    { display_name: 'Ana López' },
    { display_name: '' },
    { email: 'correo-de-prueba' },
    null
  ]), ['Ana López', 'Zoe Ruiz']);
  assert.deepEqual(normalizeTechnicianNames(null), []);
});

test('el RPC solo devuelve nombres y limita la lista a técnicos activos autenticados', () => {
  assert.match(migration, /returns table \(display_name text\)/i);
  assert.match(migration, /auth\.uid\(\) is null or not private\.taller_user_is_active\(\)/i);
  assert.match(migration, /where p\.active = true\s+and p\.role = 'mechanic'/i);
  assert.match(migration, /select distinct p\.display_name/i);
  assert.doesNotMatch(migration, /p\.email|returns table \([^)]*email/i);
  assert.match(migration, /grant execute on function public\.get_active_technician_names\(\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.get_active_technician_names\(\) from public, anon/i);
});

test('el endpoint cloud usa el RPC, mientras la sugerencia de equipo local sigue aislada', () => {
  assert.match(backend, /rpc\('get_active_technician_names'\)/);
  assert.match(backend, /pathname === '\/api\/technicians'/);
  assert.match(main, /if \(cloudMode && technician && technician\.tagName !== 'SELECT'\)/);
  assert.match(main, /else if \(technician && !\$\('#teamMemberSuggestions'\)\)/);
  assert.match(main, /renderCloudTechnicianSelect/);
});
