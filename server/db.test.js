import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const testDataDir = mkdtempSync(path.join(os.tmpdir(), 'taller-control-test-'));
const legacyDb = new DatabaseSync(path.join(testDataDir, 'taller-control.sqlite'));
legacyDb.exec(`CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'mechanic' CHECK (role = 'mechanic'),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
)`);
legacyDb.prepare(`INSERT INTO users (id,email,display_name,password_salt,password_hash,role,active,created_at)
  VALUES (?,?,?,?,?,'mechanic',1,?)`).run('legacy-mechanic-id', 'tecnico-previo@taller.test', 'Técnico Previo', randomBytes(16).toString('hex'), randomBytes(64).toString('hex'), new Date().toISOString());
legacyDb.close();

process.env.TALLER_DATA_DIR = testDataDir;
const { createInitialManager, createMechanic, getDatabase, listMechanics, setMechanicActive, closeDatabase, nowIso } = await import('./db.js');
const ephemeralPassword = () => randomBytes(24).toString('base64url');

after(() => {
  try { closeDatabase(); } catch {}
  rmSync(testDataDir, { recursive: true, force: true });
});

test('migra la tabla anterior, permite un solo encargado inicial y revoca sesiones al desactivar técnicos', () => {
  const legacyUser = getDatabase().prepare('SELECT is_manager FROM users WHERE id = ?').get('legacy-mechanic-id');
  assert.equal(legacyUser.is_manager, 0);
  assert.equal(listMechanics().length, 1);

  const manager = createInitialManager({ email: 'encargado@taller.test', displayName: 'Encargado Inicial', password: ephemeralPassword() });
  assert.equal(manager.role, 'manager');
  assert.equal(manager.is_technician, true);
  assert.throws(() => createInitialManager({ email: 'otro@taller.test', displayName: 'Otro encargado', password: ephemeralPassword() }), /ya existe/);

  const mechanic = createMechanic({ email: 'tecnico@taller.test', displayName: 'Técnico Uno', password: ephemeralPassword() });
  assert.equal(mechanic.role, 'mechanic');
  assert.equal(mechanic.is_technician, true);
  assert.equal(listMechanics().length, 2);
  assert.equal(listMechanics().some((person) => person.id === 'legacy-mechanic-id'), true);

  getDatabase().prepare('INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run('a'.repeat(64), mechanic.id, nowIso(), Date.now() + 60_000);
  setMechanicActive(mechanic.id, false);
  assert.equal(listMechanics().find((person) => person.id === mechanic.id).active, 0);
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(mechanic.id).count, 0);

  setMechanicActive(mechanic.id, true);
  assert.equal(listMechanics().find((person) => person.id === mechanic.id).active, 1);
});
