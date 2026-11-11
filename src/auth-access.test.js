import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
const backend = await readFile(new URL('./supabase-backend.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261111004500_tighten_security.sql', import.meta.url), 'utf8');
const edgeFunction = await readFile(new URL('../supabase/functions/create-technician/index.ts', import.meta.url), 'utf8');
const supabaseConfig = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');

function sourceBlock(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `expected source block starting with ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `expected source block ending with ${end}`);
  return source.slice(startAt, endAt + end.length);
}

test('la autenticación pública solo ofrece iniciar sesión, sin registro inicial ni alta directa desde navegador', () => {
  assert.match(main, /<h2>Iniciar sesión<\/h2>/);
  assert.match(main, /serverRequest\('\/api\/auth\/login',\s*\{\s*method:\s*'POST'/);
  assert.doesNotMatch(main, /Crear cuenta inicial|toggleAuthMode|registerInitialAccount/);
  assert.doesNotMatch(backend, /registerInitialAccount|pathname\s*===\s*'\/api\/auth\/register'/);
  assert.doesNotMatch(backend, /temporaryAuth|auth\.signUp\(/);
  assert.doesNotMatch(`${main}\n${backend}`, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
});

test('la administración de usuarios requiere encargado y define contraseña inicial con confirmación manual sin correo', () => {
  const adminUi = sourceBlock(main, 'function setupAuthorizedUsersUi()', 'function renderAuthorizedUsers()');
  const openAdmin = sourceBlock(main, 'async function openUserAdminModal()', 'function closeUserAdminModal()');
  const addUser = sourceBlock(main, 'async function addAuthorizedUser(event)', 'async function toggleAuthorizedUser');
  assert.match(adminUi, /id="userAdminModal"/);
  assert.match(adminUi, /id="authorizedUserForm"/);
  assert.match(adminUi, /id="authorizedUserPassword"[^>]*minlength="12"/);
  assert.match(adminUi, /confirma el correo sin enviar mensajes/);
  assert.match(adminUi, /verifica el correo/i);
  assert.match(main, /if \(!hostedMode \|\| user\?\.role !== 'manager'\) return;/);
  assert.match(openAdmin, /user\?\.role !== 'manager'/);
  assert.match(addUser, /user\?\.role !== 'manager'/);
  assert.match(addUser, /serverRequest\('\/api\/admin\/users',\s*\{\s*method:\s*'POST'/);
  assert.match(backend, /pathname === '\/api\/admin\/users' && method === 'GET'/);
  assert.match(backend, /pathname === '\/api\/admin\/users' && method === 'POST'\) return await createTechnician/);
  assert.match(backend, /functions\.invoke\('create-technician'/);
});

test('la Edge Function valida JWT y encargado activo antes de escribir invitación o crear usuario', () => {
  const tokenRead = edgeFunction.indexOf("request.headers.get('authorization')");
  const jwtVerify = edgeFunction.indexOf('authClient.auth.getUser(');
  const managerQuery = edgeFunction.indexOf("admin.from('profiles')");
  const managerGuard = edgeFunction.indexOf('if (!manager || manager.active !== true');
  const invitationWrite = edgeFunction.indexOf("admin.from('technician_invitations')");
  const accountCreate = edgeFunction.indexOf('admin.auth.admin.createUser(');
  assert.ok(tokenRead >= 0 && jwtVerify > tokenRead);
  assert.ok(managerQuery > jwtVerify && managerGuard > managerQuery);
  assert.ok(invitationWrite > managerGuard, 'no invitation writes before active-manager validation');
  assert.ok(accountCreate > managerGuard, 'no Auth account creation before active-manager validation');
  assert.match(edgeFunction, /manager\.role !== 'mechanic' \|\| manager\.is_manager !== true/);
  assert.match(edgeFunction, /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/);
  assert.match(edgeFunction, /email_confirm:\s*true/);
  assert.doesNotMatch(edgeFunction, /inviteUserByEmail|auth\.signUp\(/);
  assert.match(edgeFunction, /const tokenHash = await sha256\(invitationToken\)/);
  assert.match(edgeFunction, /token_hash:\s*tokenHash/);
  assert.match(edgeFunction, /invitation_token:\s*invitationToken/);
  assert.match(edgeFunction, /updateUserById\(created\.user\.id,\s*\{ user_metadata: \{ display_name: displayName \} \}\)/);
  assert.match(edgeFunction, /https:\/\/taller-control-web\.pages\.dev/);
  assert.match(supabaseConfig, /\[functions\.create-technician\][\s\S]*?verify_jwt\s*=\s*true/);
});

test('una sesión revocada vuelve a pedir ingreso sin ampliar los permisos anónimos', () => {
  const cloudRequest = sourceBlock(main, 'async function serverRequest', 'function startServerRefresh()');
  assert.match(cloudRequest, /if \(error\?\.status === 401\) lockExpiredSession\(\)/);
  assert.match(backend, /const translated = translateError\(error\);[\s\S]*translated\?\.code === '42501'[\s\S]*db\.auth\.getUser\(\)[\s\S]*authError \|\| !authData\?\.user[\s\S]*db\.auth\.signOut\(\{ scope: 'local' \}\)[\s\S]*apiError\('La sesión venció o fue revocada; vuelve a iniciar sesión\.', 401/);
  assert.match(backend, /throw translated;/);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete)[^;]*\bto\s+anon/i);
});

test('la base de datos conserva invitaciones de un solo uso y políticas exclusivas del encargado', () => {
  assert.match(migration, /create policy technician_invitations_manager_all[\s\S]*?for all to authenticated[\s\S]*?using \(\(select private\.taller_user_is_manager\(\)\)\)[\s\S]*?with check \(\(select private\.taller_user_is_manager\(\)\)\)/i);
  assert.match(migration, /i\.token_hash = encode\(extensions\.digest\(v_token, 'sha256'\), 'hex'\)/i);
  assert.match(migration, /i\.accepted_at is null/i);
  assert.match(migration, /i\.expires_at > now\(\)/i);
  assert.match(migration, /update public\.technician_invitations set accepted_at = now\(\)/i);
});
