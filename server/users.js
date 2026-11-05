import { createInterface } from 'node:readline';
import { createMechanic, deactivateMechanic, closeDatabase } from './db.js';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}
function ask(question) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => input.question(question, (answer) => { input.close(); resolve(answer.trim()); }));
}
function askSecret(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Para escribir la contraseña sin mostrarla, ejecuta este comando desde una terminal interactiva.'));
  }
  return new Promise((resolve, reject) => {
    const chars = [];
    process.stdout.write(prompt);
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error, value) => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') return finish(new Error('Operación cancelada.'));
        if (character === '\r' || character === '\n') return finish(null, chars.join(''));
        if (character === '\u007f' || character === '\b') chars.pop();
        else chars.push(character);
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  if (process.argv[2] === 'disable') {
    const email = option('email') || await ask('Correo del técnico que dejará de tener acceso: ');
    deactivateMechanic(email);
    console.log(`Cuenta desactivada y sesiones revocadas: ${email.trim().toLowerCase()}.`);
    return;
  }
  if (process.argv[2] !== 'add') {
    console.log('Uso:');
    console.log('  npm run user:add -- --email correo --name "Nombre"');
    console.log('  npm run user:disable -- --email correo');
    console.log('Las cuentas son de mecánicos y no hay registro desde la web.');
    process.exitCode = 2;
    return;
  }
  const email = option('email') || await ask('Correo del técnico: ');
  const displayName = option('name') || await ask('Nombre del técnico: ');
  const password = await askSecret('Contraseña nueva (12 caracteres mínimo): ');
  const confirmation = await askSecret('Repite la contraseña: ');
  if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
  const user = createMechanic({ email, displayName, password });
  console.log(`Cuenta creada para ${user.display_name} (${user.email}). Rol asignado: técnico mecánico.`);
}

main().catch((error) => {
  console.error(`No se pudo crear la cuenta: ${error.message}`);
  process.exitCode = 1;
}).finally(() => {
  try { closeDatabase(); } catch {}
});
