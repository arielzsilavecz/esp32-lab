import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL en el entorno (ver .env.example).');
}

// rejectUnauthorized:false es permisivo a proposito: Railway no siempre
// entrega la cadena de certificados completa por la URL publica. Revisar si
// hace falta endurecerlo cuando el trafico salga de "yo mismo probando".
const useSsl = !process.env.DATABASE_URL.includes('localhost');

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});
