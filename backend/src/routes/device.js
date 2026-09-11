import { Router } from 'express';
import { pool } from '../db.js';
import { requireDeviceToken } from '../deviceAuth.js';
import { publishDeviceState } from '../stateEvents.js';
import { notifyZoneChanges } from '../pushNotifications.js';

export const deviceRouter = Router();

deviceRouter.use(requireDeviceToken);

// Mantiene viva la conexion TLS del dispositivo. Railway cierra los sockets
// ociosos a los 60s exactos (medido) y rehacer el handshake le cuesta ~1.9s a
// un ESP32, contra ~250ms de una request sobre una conexion ya abierta -- ver
// ADR-0009. No consulta la base a proposito: el unico objetivo es que el
// socket no muera, asi que conviene que sea lo mas barato posible.
deviceRouter.get('/ping', (_req, res) => {
  // Un body corto obliga al HTTPClient del ESP32 a consumir la respuesta
  // completa antes de conservar el socket. Con 204 dejaba un socket TLS que
  // en la siguiente request aparecia conectado, pero ya no era reutilizable.
  res.status(200).type('text/plain').send('ok');
});

// La ESP32 llama esto cada ~1s (ver ADR-0006 por que 1s no cambia el costo).
deviceRouter.get('/comando-pendiente', async (req, res) => {
  const result = await pool.query(
    `SELECT id, tipo_comando FROM comandos
     WHERE dispositivo_id = $1 AND consumido_at IS NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    [req.dispositivo.id]
  );

  if (result.rowCount === 0) {
    return res.status(204).end();
  }
  res.json(result.rows[0]);
});

deviceRouter.post('/comando/:id/consumido', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(
    `UPDATE comandos SET consumido_at = now()
     WHERE id = $1 AND dispositivo_id = $2 AND consumido_at IS NULL
     RETURNING id`,
    [id, req.dispositivo.id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Comando no encontrado o ya consumido' });
  }
  res.json({ ok: true });
});

// Direccion opuesta a comando-pendiente: el dispositivo empuja su propio
// estado en vez de consultar que hacer. Sin validar el shape de `estado` a
// proposito -- mismo criterio que dispositivos.tipo, es JSONB libre porque
// todavia no hay un catalogo cerrado de que reporta cada tipo de dispositivo.
deviceRouter.post('/estado', async (req, res) => {
  const { estado } = req.body || {};
  if (estado === undefined) {
    return res.status(400).json({ error: 'Falta "estado" en el body' });
  }

  // Un solo statement para que el valor actual y su copia en el historial no
  // puedan quedar desfasados: dispositivos.estado es el ultimo valor (lo que
  // lee la pagina al cargar) y estados guarda cada reporte para el log.
  const result = await pool.query(
    `WITH anterior AS (
       SELECT id, estado FROM dispositivos WHERE id = $2 FOR UPDATE
     ), actualizado AS (
       UPDATE dispositivos AS d SET estado = $1, estado_actualizado_at = now()
       FROM anterior AS a
       WHERE d.id = a.id
       RETURNING d.id, d.nombre, d.tipo, d.estado, d.estado_actualizado_at,
                 a.estado AS estado_anterior
     ), guardado AS (
     INSERT INTO estados (dispositivo_id, estado, created_at)
     SELECT id, estado, estado_actualizado_at FROM actualizado
     RETURNING dispositivo_id
     )
     SELECT * FROM actualizado`,
    [estado, req.dispositivo.id]
  );
  const update = result.rows[0];
  publishDeviceState(update);
  res.json({ ok: true });

  // El reporte del ESP32 no debe demorarse ni fallar porque un proveedor Push
  // este caido. La notificacion continua en segundo plano despues del 200.
  void notifyZoneChanges(update, update.estado_anterior, update.estado)
    .catch((error) => console.error('Fallo procesando notificaciones:', error.message));
});
