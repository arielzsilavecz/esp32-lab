import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sin tabla de migraciones aplicadas: no hace falta todavia con un solo
// desarrollador y un puñado de archivos. Cada migracion se corre a mano una
// vez, pasando su nombre -- default a 001_init.sql para no romper el uso
// existente de `npm run migrate` en una base nueva.
const [, , archivo = '001_init.sql'] = process.argv;
const sqlPath = path.join(__dirname, '..', 'migrations', archivo);
const sql = readFileSync(sqlPath, 'utf-8');

await pool.query(sql);
console.log(`Migracion aplicada: ${archivo}`);
await pool.end();
