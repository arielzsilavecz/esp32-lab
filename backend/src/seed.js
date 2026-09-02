// Alta de usuarios y dispositivos a mano, sin flujo de signup publico -- mismo
// modelo de confianza que gastos-app (cuentas se crean desde el lado del
// admin, no self-signup). Ver docs/decisions/0006-backend-smart-home.md.
//
// Uso:
//   node src/seed.js usuario <email> <password> <nombre>
//   node src/seed.js dispositivo <nombre> <tipo>

import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { pool } from './db.js';

async function crearUsuario(email, password, nombre) {
  const hash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    'INSERT INTO usuarios (email, password_hash, nombre) VALUES ($1, $2, $3) RETURNING id',
    [email, hash, nombre]
  );
  console.log(`Usuario creado: id=${result.rows[0].id} email=${email}`);
}

async function crearDispositivo(nombre, tipo) {
  const token = crypto.randomBytes(32).toString('hex');
  const result = await pool.query(
    'INSERT INTO dispositivos (nombre, tipo, token) VALUES ($1, $2, $3) RETURNING id',
    [nombre, tipo, token]
  );
  console.log(`Dispositivo creado: id=${result.rows[0].id} nombre="${nombre}" tipo=${tipo}`);
  console.log(`Token (va en Secrets.h del firmware, no se vuelve a mostrar):\n  ${token}`);
}

const [, , comando, ...args] = process.argv;

if (comando === 'usuario') {
  const [email, password, nombre] = args;
  if (!email || !password || !nombre) {
    console.error('Uso: node src/seed.js usuario <email> <password> <nombre>');
    process.exit(1);
  }
  await crearUsuario(email, password, nombre);
} else if (comando === 'dispositivo') {
  const [nombre, tipo] = args;
  if (!nombre || !tipo) {
    console.error('Uso: node src/seed.js dispositivo <nombre> <tipo>');
    process.exit(1);
  }
  await crearDispositivo(nombre, tipo);
} else {
  console.error('Uso: node src/seed.js usuario|dispositivo ...');
  process.exit(1);
}

await pool.end();
