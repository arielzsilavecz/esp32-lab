import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '..', 'migrations', '001_init.sql');
const sql = readFileSync(sqlPath, 'utf-8');

await pool.query(sql);
console.log('Migracion aplicada: 001_init.sql');
await pool.end();
