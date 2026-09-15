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
  // Toda request autenticada es prueba de contacto, aunque ninguna zona cambie.
  // Limitar escrituras a una cada 5s por identidad.
  await pool.query(
    `UPDATE dispositivos SET last_seen_at = clock_timestamp()
     WHERE id = $1 AND (last_seen_at IS NULL
       OR last_seen_at < clock_timestamp() - interval '5 seconds')`,
    [req.dispositivo.id]
  );
  next();
}
