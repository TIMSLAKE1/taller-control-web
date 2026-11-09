import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { spawn } from 'node:child_process';
import { BlockList, isIP } from 'node:net';
import { readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import {
  dataDir, evidenceDir, getDatabase, hashToken, nowIso, publicUser, verifyPassword,
  createMechanic, listMechanics, setMechanicActive
} from './db.js';

const db = getDatabase();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const host = process.env.TALLER_HOST || '0.0.0.0';
const port = Number(process.env.PORT || process.env.TALLER_PORT || 3000);
const tlsCertPath = process.env.TALLER_TLS_CERT || '';
const tlsKeyPath = process.env.TALLER_TLS_KEY || '';
if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath)) {
  throw new Error('Para activar HTTPS local, configura juntos TALLER_TLS_CERT y TALLER_TLS_KEY.');
}
const secureTransport = Boolean(tlsCertPath && tlsKeyPath);
const protocol = secureTransport ? 'https' : 'http';
const sessionDurationMs = 12 * 60 * 60 * 1000;
const maxJsonBytes = 2 * 1024 * 1024;
const maxPhotoBytes = 10 * 1024 * 1024;
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif']);
const validStatuses = new Set(['Borrador', 'Inspección', 'Aprobación', 'En servicio', 'Completa', 'Cancelada']);
const loginAttempts = new Map();
let loginChecks = 0;
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'"
};
if (secureTransport) securityHeaders['Strict-Transport-Security'] = 'max-age=31536000';
const trustedLan = new BlockList();
for (const [subnet, prefix, type] of [
  ['10.0.0.0', 8, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.168.0.0', 16, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'], ['169.254.0.0', 16, 'ipv4'],
  ['fc00::', 7, 'ipv6'], ['fe80::', 10, 'ipv6']
]) trustedLan.addSubnet(subnet, prefix, type);

function isTrustedLanAddress(remoteAddress) {
  const address = String(remoteAddress || '').replace(/^::ffff:/i, '');
  const family = isIP(address);
  return address === '::1' || (family === 4 && trustedLan.check(address, 'ipv4')) || (family === 6 && trustedLan.check(address, 'ipv6'));
}

function sendJson(res, status, value, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...securityHeaders,
    ...extraHeaders
  });
  res.end(body);
}
function fail(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  throw error;
}
async function readBody(req, limit) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > limit) fail(413, 'El archivo o la solicitud excede el tamaño permitido.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, 'El archivo o la solicitud excede el tamaño permitido.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
async function readJson(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') fail(415, 'Se esperaba una solicitud JSON.');
  try { return JSON.parse((await readBody(req, maxJsonBytes)).toString('utf8')); }
  catch (error) { if (error.statusCode) throw error; fail(400, 'La solicitud contiene JSON inválido.'); }
}
function cookieValue(req, name) {
  const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : '';
}
function sessionCookie(token, req) {
  return `taller_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(sessionDurationMs / 1000)}${req.socket.encrypted ? '; Secure' : ''}`;
}
function clearedCookie(req) {
  return `taller_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${req.socket.encrypted ? '; Secure' : ''}`;
}
function validateOrigin(req) {
  const origin = req.headers.origin;
  const host = String(req.headers.host || '');
  if (!origin || !host) fail(403, 'La solicitud debe incluir un origen válido.');
  let parsedOrigin; let parsedHost;
  try {
    const protocol = req.socket.encrypted ? 'https' : 'http';
    parsedOrigin = new URL(origin);
    parsedHost = new URL(`${protocol}://${host}`);
  } catch { fail(403, 'Origen de solicitud no permitido.'); }
  if (parsedHost.host.toLowerCase() !== host.toLowerCase() || parsedOrigin.origin !== parsedHost.origin) {
    fail(403, 'Origen de solicitud no permitido.');
  }
}
function getSession(req) {
  const token = cookieValue(req, 'taller_session');
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = db.prepare(`SELECT s.token_hash, s.expires_at, u.id, u.email, u.display_name, u.role, u.is_manager, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(hashToken(token));
  if (!row || row.active !== 1 || row.expires_at <= Date.now()) {
    if (row) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  return row;
}
function requireMechanic(req) {
  const session = getSession(req);
  if (!session) fail(401, 'Inicia sesión con una cuenta de técnico mecánico.');
  // El encargado inicial mantiene además el rol técnico y usa las mismas funciones operativas.
  if (session.role !== 'mechanic') fail(403, 'Esta cuenta no tiene permiso para usar el taller.');
  return session;
}
function requireManager(session) {
  if (Number(session.is_manager) !== 1) fail(403, 'Solo el encargado puede administrar las cuentas de técnicos.');
}
function clearOldSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  loginChecks = 0;
}
function registerFailedLogin(key) {
  const current = Date.now();
  const item = loginAttempts.get(key);
  if (!item || current - item.firstAt > 15 * 60 * 1000) {
    if (loginAttempts.size >= 5000) {
      for (const [attemptKey, attempt] of loginAttempts) {
        if (current - attempt.firstAt > 15 * 60 * 1000) loginAttempts.delete(attemptKey);
      }
      while (loginAttempts.size >= 5000) loginAttempts.delete(loginAttempts.keys().next().value);
    }
    loginAttempts.set(key, { firstAt: current, count: 1 });
  }
  else item.count += 1;
}
function checkLoginLimit(key) {
  const item = loginAttempts.get(key);
  if (item && Date.now() - item.firstAt <= 15 * 60 * 1000 && item.count >= 10) fail(429, 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.');
  if (item && Date.now() - item.firstAt > 15 * 60 * 1000) loginAttempts.delete(key);
}
function parseOrder(row) {
  return JSON.parse(row.data_json);
}
function validateOrder(order, pathId) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) fail(400, 'Orden inválida.');
  if (typeof order.id !== 'string' || order.id !== pathId || !/^[a-zA-Z0-9-]{8,80}$/.test(order.id)) fail(400, 'Identificador de orden inválido.');
  if (typeof order.order_number !== 'string' || order.order_number.length > 80) fail(400, 'Folio de orden inválido.');
  if (!validStatuses.has(order.status)) fail(400, 'Estado de orden inválido.');
  if (!order.customer || typeof order.customer !== 'object' || !order.vehicle || typeof order.vehicle !== 'object') fail(400, 'Faltan los datos de cliente o vehículo.');
  if (!Array.isArray(order.evidence)) order.evidence = [];
  if (order.evidence.length > 6) fail(400, 'Una orden puede tener un máximo de 6 fotos.');
  for (const photo of order.evidence) {
    if (!photo.photoId || !db.prepare('SELECT 1 AS ok FROM evidence_files WHERE id = ? AND service_order_id = ?').get(photo.photoId, pathId)) {
      fail(400, 'La evidencia incluye una foto que no pertenece a esta orden.');
    }
  }
  if (Buffer.byteLength(JSON.stringify(order), 'utf8') > maxJsonBytes) fail(413, 'La orden supera el tamaño permitido.');
  return order;
}
function listData() {
  const orders = db.prepare('SELECT data_json FROM service_orders ORDER BY received_at DESC LIMIT 2000').all().map(parseOrder);
  const expenseRows = db.prepare(`SELECT e.id, e.expense_date, e.category, e.description, e.amount, e.service_order_id, e.created_at,
      f.id AS proof_id, f.original_name AS proof_name, f.media_type AS proof_type, f.size AS proof_size, f.created_at AS proof_created_at
    FROM shop_expenses e LEFT JOIN expense_evidence_files f ON f.expense_id = e.id
    ORDER BY e.expense_date DESC LIMIT 2000`).all();
  const expenses = expenseRows.map((row) => ({
    id: row.id, expense_date: row.expense_date, category: row.category, description: row.description,
    amount: row.amount, service_order_id: row.service_order_id, created_at: row.created_at,
    proof: row.proof_id ? { photoId: row.proof_id, name: row.proof_name, type: row.proof_type, size: row.proof_size, created_at: row.proof_created_at } : null
  }));
  return { orders, expenses };
}
function mimeType(filePath) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}
function serveStatic(req, res, pathname) {
  let relative;
  try { relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); }
  catch { return sendJson(res, 400, { error: 'Ruta inválida.' }); }
  const target = path.resolve(distDir, `.${relative}`);
  if (!target.startsWith(`${distDir}${path.sep}`) && target !== path.join(distDir, 'index.html')) return sendJson(res, 404, { error: 'No encontrado.' });
  let filePath = target;
  try { if (!statSync(filePath).isFile()) throw new Error('not a file'); }
  catch { return sendJson(res, 404, { error: 'Archivo no encontrado. Ejecuta npm run build.' }); }
  const body = readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': mimeType(filePath),
    'Content-Length': body.length,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    ...securityHeaders
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
function safeName(value) {
  return String(value || 'evidencia').replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(-180) || 'evidencia';
}
function imageBytesMatch(bytes, mediaType) {
  if (mediaType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mediaType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (mediaType === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mediaType === 'image/avif' || mediaType === 'image/heic' || mediaType === 'image/heif') {
    if (bytes.length < 12 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
    const brands = bytes.subarray(8, Math.min(bytes.length, 64)).toString('ascii');
    if (mediaType === 'image/avif') return brands.includes('avif') || brands.includes('avis');
    return ['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1'].some((brand) => brands.includes(brand));
  }
  return false;
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/session' && req.method === 'GET') {
    const session = getSession(req);
    return sendJson(res, 200, session ? { authenticated: true, user: publicUser(session) } : { authenticated: false, user: null });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    validateOrigin(req);
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const key = `${req.socket.remoteAddress || 'unknown'}:${email}`;
    checkLoginLimit(key);
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
    const valid = verifyPassword(user, password) && user.active === 1 && user.role === 'mechanic';
    if (!valid) {
      registerFailedLogin(key);
      return sendJson(res, 401, { error: 'Correo o contraseña incorrectos. Si tienes autorización, solicita una cuenta al encargado del taller.' });
    }
    loginAttempts.delete(key);
    const token = randomBytes(32).toString('hex');
    const createdAt = nowIso();
    const expiresAt = Date.now() + sessionDurationMs;
    db.prepare('INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
      .run(hashToken(token), user.id, createdAt, expiresAt);
    if (++loginChecks % 100 === 0) clearOldSessions();
    return sendJson(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token, req) });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    validateOrigin(req);
    const token = cookieValue(req, 'taller_session');
    if (/^[a-f0-9]{64}$/.test(token)) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie(req) });
  }

  const session = requireMechanic(req);
  if (req.method !== 'GET') validateOrigin(req);

  if (pathname === '/api/admin/users' && req.method === 'GET') {
    requireManager(session);
    return sendJson(res, 200, { users: listMechanics() });
  }

  if (pathname === '/api/admin/users' && req.method === 'POST') {
    requireManager(session);
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Los datos de la cuenta no son válidos.');
    let created;
    try {
      created = createMechanic({ email: body.email, displayName: body.display_name, password: body.password });
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed: users.email')) fail(409, 'Ya existe una cuenta con ese correo.');
      if (['Escribe un correo electrónico válido.', 'El nombre debe tener entre 2 y 100 caracteres.', 'La contraseña debe tener entre 12 y 200 caracteres.'].includes(error.message)) fail(400, error.message);
      throw error;
    }
    return sendJson(res, 201, { user: { ...created, active: 1, created_at: nowIso() } });
  }

  const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserMatch && req.method === 'PATCH') {
    requireManager(session);
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Los datos de la cuenta no son válidos.');
    if (typeof body.active !== 'boolean') fail(400, 'Indica si la cuenta debe quedar activa o desactivada.');
    const id = decodeURIComponent(adminUserMatch[1]);
    try { setMechanicActive(id, body.active); }
    catch (error) {
      if (error.message === 'No se encontró una cuenta de técnico mecánico administrable.') fail(404, error.message);
      throw error;
    }
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/data' && req.method === 'GET') return sendJson(res, 200, listData());

  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && req.method === 'PUT') {
    const orderId = decodeURIComponent(orderMatch[1]);
    const order = validateOrder(await readJson(req), orderId);
    const existing = db.prepare('SELECT created_at FROM service_orders WHERE id = ?').get(orderId);
    order.updated_at = nowIso();
    order.created_at = existing?.created_at || order.created_at || order.updated_at;
    const customerName = String(order.customer?.name || '').slice(0, 200);
    const plate = String(order.vehicle?.plate || '').slice(0, 40);
    try {
      db.prepare(`INSERT INTO service_orders (id,order_number,received_at,status,customer_name,vehicle_plate,data_json,created_at,updated_at)
        VALUES (@id,@order_number,@received_at,@status,@customer_name,@vehicle_plate,@data_json,@created_at,@updated_at)
        ON CONFLICT(id) DO UPDATE SET order_number=excluded.order_number, received_at=excluded.received_at,
        status=excluded.status, customer_name=excluded.customer_name, vehicle_plate=excluded.vehicle_plate,
        data_json=excluded.data_json, updated_at=excluded.updated_at`).run({
          id: order.id, order_number: order.order_number, received_at: order.received_at || order.updated_at,
          status: order.status, customer_name: customerName, vehicle_plate: plate, data_json: JSON.stringify(order),
          created_at: order.created_at, updated_at: order.updated_at
        });
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed: service_orders.order_number')) fail(409, 'Ese folio ya está asignado. Actualiza la lista y vuelve a guardar.');
      throw error;
    }
    return sendJson(res, 200, { order });
  }

  if (pathname === '/api/expenses' && req.method === 'POST') {
    const body = await readJson(req);
    const expense = {
      id: typeof body.id === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(body.id) ? body.id : randomUUID(),
      expense_date: String(body.expense_date || '').slice(0, 10),
      category: String(body.category || '').trim().slice(0, 80),
      description: String(body.description || '').trim().slice(0, 160),
      amount: Number(body.amount), service_order_id: body.service_order_id || null, created_at: nowIso(), created_by: session.id
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expense.expense_date) || !expense.category || !expense.description || !Number.isFinite(expense.amount) || expense.amount <= 0) fail(400, 'Fecha, categoría, descripción e importe mayor que cero son obligatorios.');
    db.prepare(`INSERT INTO shop_expenses (id,expense_date,category,description,amount,service_order_id,created_by,created_at)
      VALUES (@id,@expense_date,@category,@description,@amount,@service_order_id,@created_by,@created_at)`).run(expense);
    return sendJson(res, 201, { expense });
  }

  const expenseProofUploadMatch = pathname.match(/^\/api\/expenses\/([^/]+)\/proof$/);
  if (expenseProofUploadMatch && req.method === 'POST') {
    const expenseId = decodeURIComponent(expenseProofUploadMatch[1]);
    if (!db.prepare('SELECT 1 AS ok FROM shop_expenses WHERE id = ?').get(expenseId)) fail(404, 'Registra el gasto antes de adjuntar el comprobante.');
    if (db.prepare('SELECT 1 AS ok FROM expense_evidence_files WHERE expense_id = ?').get(expenseId)) fail(409, 'Este gasto ya tiene una imagen; elimina el comprobante anterior antes de reemplazarlo.');
    const mediaType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!allowedImageTypes.has(mediaType)) fail(415, 'Tipo de imagen no admitido. Usa JPEG, PNG, WebP, GIF, AVIF o HEIC.');
    const bytes = await readBody(req, maxPhotoBytes);
    if (!bytes.length) fail(400, 'El archivo está vacío.');
    if (!imageBytesMatch(bytes, mediaType)) fail(415, 'El contenido del archivo no coincide con su formato de imagen.');
    const proof = { id: randomUUID(), expense_id: expenseId, original_name: safeName(req.headers['x-file-name']), media_type: mediaType, size: bytes.length, created_at: nowIso() };
    const filePath = path.join(evidenceDir, `${proof.id}.blob`);
    writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o600 });
    try {
      db.prepare(`INSERT INTO expense_evidence_files (id,expense_id,original_name,media_type,size,created_at)
        VALUES (@id,@expense_id,@original_name,@media_type,@size,@created_at)`).run(proof);
    } catch (error) { try { unlinkSync(filePath); } catch {} throw error; }
    return sendJson(res, 201, { proof: { photoId: proof.id, name: proof.original_name, type: proof.media_type, size: proof.size, created_at: proof.created_at } });
  }

  const expenseProofDeleteMatch = pathname.match(/^\/api\/expenses\/([^/]+)\/proof$/);
  if (expenseProofDeleteMatch && req.method === 'DELETE') {
    const expenseId = decodeURIComponent(expenseProofDeleteMatch[1]);
    const proof = db.prepare('SELECT id FROM expense_evidence_files WHERE expense_id = ?').get(expenseId);
    if (!proof) fail(404, 'Este gasto no tiene una imagen adjunta.');
    db.prepare('DELETE FROM expense_evidence_files WHERE id = ?').run(proof.id);
    try { unlinkSync(path.join(evidenceDir, `${proof.id}.blob`)); } catch {}
    return sendJson(res, 200, { ok: true });
  }

  const expenseProofGetMatch = pathname.match(/^\/api\/expense-proofs\/([^/]+)$/);
  if (expenseProofGetMatch && req.method === 'GET') {
    const proofId = decodeURIComponent(expenseProofGetMatch[1]);
    const proof = db.prepare('SELECT media_type,size FROM expense_evidence_files WHERE id = ?').get(proofId);
    if (!proof) fail(404, 'No se encontró la imagen del gasto.');
    let file;
    try { file = readFileSync(path.join(evidenceDir, `${proofId}.blob`)); } catch { fail(404, 'No se encontró el archivo de imagen.'); }
    res.writeHead(200, { 'Content-Type': proof.media_type, 'Content-Length': file.length, 'Cache-Control': 'private, no-store', ...securityHeaders });
    return res.end(file);
  }

  const expenseMatch = pathname.match(/^\/api\/expenses\/([^/]+)$/);
  if (expenseMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(expenseMatch[1]);
    const proof = db.prepare('SELECT id FROM expense_evidence_files WHERE expense_id = ?').get(id);
    db.prepare('DELETE FROM shop_expenses WHERE id = ?').run(id);
    if (proof) { try { unlinkSync(path.join(evidenceDir, `${proof.id}.blob`)); } catch {} }
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/events' && req.method === 'POST') {
    const body = await readJson(req);
    const orderId = String(body.order_id || '');
    if (!db.prepare('SELECT 1 AS ok FROM service_orders WHERE id = ?').get(orderId)) fail(404, 'No se encontró la orden para guardar el evento.');
    const event = { id: randomUUID(), service_order_id: orderId, event_type: String(body.event_type || '').slice(0, 80), details_json: JSON.stringify(body.details || {}), actor_id: session.id, created_at: nowIso() };
    if (!event.event_type) fail(400, 'El evento debe incluir un tipo.');
    db.prepare(`INSERT INTO service_order_events (id,service_order_id,event_type,details_json,actor_id,created_at)
      VALUES (@id,@service_order_id,@event_type,@details_json,@actor_id,@created_at)`).run(event);
    return sendJson(res, 201, { ok: true });
  }

  const photoUploadMatch = pathname.match(/^\/api\/orders\/([^/]+)\/photos$/);
  if (photoUploadMatch && req.method === 'POST') {
    const orderId = decodeURIComponent(photoUploadMatch[1]);
    if (!db.prepare('SELECT 1 AS ok FROM service_orders WHERE id = ?').get(orderId)) fail(404, 'Guarda la recepción antes de adjuntar fotos.');
    if (db.prepare('SELECT COUNT(*) AS count FROM evidence_files WHERE service_order_id = ?').get(orderId).count >= 6) fail(409, 'Una orden puede tener un máximo de 6 fotos.');
    const mediaType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!allowedImageTypes.has(mediaType)) fail(415, 'Tipo de imagen no admitido. Usa JPEG, PNG, WebP, GIF, AVIF o HEIC.');
    const bytes = await readBody(req, maxPhotoBytes);
    if (!bytes.length) fail(400, 'El archivo está vacío.');
    if (!imageBytesMatch(bytes, mediaType)) fail(415, 'El contenido del archivo no coincide con su formato de imagen.');
    const photo = { id: randomUUID(), service_order_id: orderId, original_name: safeName(req.headers['x-file-name']), media_type: mediaType, size: bytes.length, created_at: nowIso() };
    const filePath = path.join(evidenceDir, `${photo.id}.blob`);
    writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o600 });
    try {
      db.prepare(`INSERT INTO evidence_files (id,service_order_id,original_name,media_type,size,created_at)
        VALUES (@id,@service_order_id,@original_name,@media_type,@size,@created_at)`).run(photo);
    } catch (error) { try { unlinkSync(filePath); } catch {} throw error; }
    return sendJson(res, 201, { photo: { photoId: photo.id, name: photo.original_name, created_at: photo.created_at, size: photo.size, type: photo.media_type } });
  }

  const photoDeleteMatch = pathname.match(/^\/api\/orders\/([^/]+)\/photos\/([^/]+)$/);
  if (photoDeleteMatch && req.method === 'DELETE') {
    const orderId = decodeURIComponent(photoDeleteMatch[1]);
    const photoId = decodeURIComponent(photoDeleteMatch[2]);
    const photo = db.prepare('SELECT * FROM evidence_files WHERE id = ? AND service_order_id = ?').get(photoId, orderId);
    if (!photo) fail(404, 'No se encontró la foto de esa orden.');
    const orderRow = db.prepare('SELECT data_json FROM service_orders WHERE id = ?').get(orderId);
    if (!orderRow) fail(404, 'No se encontró la orden.');
    const order = JSON.parse(orderRow.data_json);
    order.evidence = (order.evidence || []).filter((item) => item.photoId !== photoId);
    order.updated_at = nowIso();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM evidence_files WHERE id = ?').run(photoId);
      db.prepare('UPDATE service_orders SET data_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(order), order.updated_at, orderId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    try { unlinkSync(path.join(evidenceDir, `${photoId}.blob`)); } catch {}
    return sendJson(res, 200, { ok: true });
  }

  const photoGetMatch = pathname.match(/^\/api\/evidence\/([^/]+)$/);
  if (photoGetMatch && req.method === 'GET') {
    const photoId = decodeURIComponent(photoGetMatch[1]);
    const photo = db.prepare(`SELECT f.media_type,f.size FROM evidence_files f
      JOIN service_orders o ON o.id=f.service_order_id WHERE f.id=?`).get(photoId);
    if (!photo) fail(404, 'No se encontró la imagen.');
    const filePath = path.join(evidenceDir, `${photoId}.blob`);
    let file;
    try { file = readFileSync(filePath); } catch { fail(404, 'No se encontró el archivo de imagen.'); }
    res.writeHead(200, { 'Content-Type': photo.media_type, 'Content-Length': file.length, 'Cache-Control': 'private, no-store', ...securityHeaders });
    return res.end(file);
  }

  return sendJson(res, 404, { error: 'Ruta de servicio no encontrada.' });
}

const requestHandler = async (req, res) => {
  if (!isTrustedLanAddress(req.socket.remoteAddress)) return sendJson(res, 403, { error: 'El servidor solo acepta conexiones desde la red privada local.' });
  let url;
  try { url = new URL(req.url || '/', `${protocol}://${req.headers.host || 'localhost'}`); }
  catch { return sendJson(res, 400, { error: 'La solicitud contiene un encabezado Host inválido.' }); }
  const pathname = url.pathname;
  if (pathname.startsWith('/api/')) {
    try { await handleApi(req, res, pathname); }
    catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (error.statusCode >= 500 || !error.statusCode) console.error('Error en API local:', error);
      sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Error interno del servidor local.' });
    }
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/api')) return sendJson(res, 404, { error: 'Ruta de servicio no encontrada.' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Método no permitido.' });
  serveStatic(req, res, pathname);
};
const server = secureTransport
  ? createHttpsServer({ key: readFileSync(tlsKeyPath), cert: readFileSync(tlsCertPath), minVersion: 'TLSv1.2' }, requestHandler)
  : createServer(requestHandler);

function openLocalBrowser(url) {
  if (process.env.TALLER_NO_OPEN_BROWSER === '1') return;
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => console.warn('No se pudo abrir el navegador automáticamente; abre la dirección local mostrada arriba.'));
    child.unref();
  } catch {
    console.warn('No se pudo abrir el navegador automáticamente; abre la dirección local mostrada arriba.');
  }
}

server.on('error', (error) => {
  console.error(`No se pudo iniciar el servidor: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`Taller Control con SQLite está escuchando en:`);
  console.log(`  ${protocol}://localhost:${port}`);
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal && trustedLan.check(address.address, 'ipv4')) console.log(`  ${protocol}://${address.address}:${port}`);
    }
  }
  console.log(`Base de datos local: ${path.join(dataDir, 'taller-control.sqlite')}`);
  console.log('Solo las cuentas autorizadas de encargado y técnicos pueden consultar los datos.');
  if (secureTransport) console.log('HTTPS está activo. Los dispositivos deben confiar en el certificado local antes de iniciar sesión.');
  else console.warn('Aviso: HTTP no cifra las credenciales ni los datos en la red local. Usa únicamente una red privada y confiable.');
  if (process.env.TALLER_NO_OPEN_BROWSER !== '1') {
    console.log('Abriendo la pantalla de acceso en este equipo…');
    openLocalBrowser(`${protocol}://localhost:${port}`);
  }
});

function shutdown() {
  server.close(() => {
    try { db.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
