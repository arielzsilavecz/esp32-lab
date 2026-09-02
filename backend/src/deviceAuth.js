import { pool } from './db.js';

// Autenticacion de dispositivo (no de persona): token fijo por fila de
// `dispositivos`, enviado como "Authorization: Bearer <token>". No pasa por
// sesion/cookie porque quien llama es la ESP32, no un navegador logueado.
export async function requireDeviceToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Falta token de dispositivo' });
  }

  const result = await pool.query(
    'SELECT id, nombre, tipo FROM dispositivos WHERE token = $1',
    [token]
  );

  if (result.rowCount === 0) {
    return res.status(401).json({ error: 'Token invalido' });
  }

  req.dispositivo = result.rows[0];
  next();
}
