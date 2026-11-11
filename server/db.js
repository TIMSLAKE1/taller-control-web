import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

process.umask(0o077);
export const dataDir = path.resolve(process.env.TALLER_DATA_DIR || path.join(process.cwd(), 'data'));
export const evidenceDir = path.join(dataDir, 'evidence');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
try { chmodSync(dataDir, 0o700); chmodSync(evidenceDir, 0o700); } catch {}

const databasePath = path.join(dataDir, 'taller-control.sqlite');
const db = new DatabaseSync(databasePath);
try { chmodSync(databasePath, 0o600); } catch {}
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'mechanic' CHECK (role = 'mechanic'),
    is_manager INTEGER NOT NULL DEFAULT 0 CHECK (is_manager IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS service_orders (
    id TEXT PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    vehicle_plate TEXT NOT NULL DEFAULT '',
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS service_orders_received_idx ON service_orders(received_at DESC);
  CREATE TABLE IF NOT EXISTS shop_expenses (
    id TEXT PRIMARY KEY,
    expense_date TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    service_order_id TEXT REFERENCES service_orders(id) ON DELETE SET NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS shop_expenses_date_idx ON shop_expenses(expense_date DESC);
  CREATE TABLE IF NOT EXISTS service_order_payments (
    id TEXT PRIMARY KEY,
    service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE RESTRICT,
    paid_on TEXT NOT NULL CHECK (length(paid_on) = 10),
    amount REAL NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('Efectivo','Transferencia','Tarjeta','Otro')),
    reference TEXT NOT NULL DEFAULT '' CHECK (length(reference) <= 160),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS service_order_payments_order_idx ON service_order_payments(service_order_id, paid_on DESC);
  CREATE INDEX IF NOT EXISTS service_order_payments_paid_on_idx ON service_order_payments(paid_on DESC);
  CREATE TABLE IF NOT EXISTS expense_evidence_files (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL UNIQUE REFERENCES shop_expenses(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS service_order_events (
    id TEXT PRIMARY KEY,
    service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS evidence_files (
    id TEXT PRIMARY KEY,
    service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const userColumns = db.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some((column) => column.name === 'is_manager')) {
  db.exec('ALTER TABLE users ADD COLUMN is_manager INTEGER NOT NULL DEFAULT 0 CHECK (is_manager IN (0, 1))');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_single_manager_idx ON users(is_manager) WHERE is_manager = 1');

export function getDatabase() { return db; }
export function nowIso() { return new Date().toISOString(); }
export function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }
export function publicUser(user) {
  return {
    id: user.id, email: user.email, display_name: user.display_name,
    role: Number(user.is_manager) === 1 ? 'manager' : user.role,
    is_technician: user.role === 'mechanic'
  };
}

export function createMechanic({ email, displayName, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const name = String(displayName || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw new Error('Escribe un correo electrónico válido.');
  }
  if (name.length < 2 || name.length > 100) throw new Error('El nombre debe tener entre 2 y 100 caracteres.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
    throw new Error('La contraseña debe tener entre 12 y 200 caracteres.');
  }
  const salt = randomBytes(16);
  const passwordHash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  const user = {
    id: randomBytes(16).toString('hex'), email: normalizedEmail, display_name: name,
    password_salt: salt.toString('hex'), password_hash: passwordHash,
    role: 'mechanic', active: 1, created_at: nowIso()
  };
  db.prepare(`INSERT INTO users (id,email,display_name,password_salt,password_hash,role,active,created_at)
    VALUES (@id,@email,@display_name,@password_salt,@password_hash,@role,@active,@created_at)`).run(user);
  return publicUser(user);
}

export function createInitialManager({ email, displayName, password }) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const count = db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_manager = 1').get().count;
    if (count !== 0) throw new Error('El encargado inicial ya existe; este comando solo se puede ejecutar una vez.');
    const user = createMechanic({ email, displayName, password });
    db.prepare('UPDATE users SET is_manager = 1 WHERE id = ?').run(user.id);
    db.exec('COMMIT');
    return publicUser({ ...user, is_manager: 1 });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listMechanics() {
  return db.prepare(`SELECT id, email, display_name, active, created_at FROM users
    WHERE role = 'mechanic' AND is_manager = 0 ORDER BY active DESC, display_name COLLATE NOCASE`).all();
}

export function setMechanicActive(id, active) {
  const user = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'mechanic' AND is_manager = 0`).get(id);
  if (!user) throw new Error('No se encontró una cuenta de técnico mecánico administrable.');
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, user.id);
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
}

export function verifyPassword(user, password) {
  if (typeof password !== 'string') return false;
  const salt = user ? Buffer.from(user.password_salt, 'hex') : Buffer.alloc(16, 0x5a);
  const expected = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64, 0xa5);
  const candidate = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const matches = expected.length === candidate.length && timingSafeEqual(expected, candidate);
  return Boolean(user && matches);
}

export function closeDatabase() { db.close(); }
