import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { subscribeToDeviceState } from '../stateEvents.js';

export const dispositivosRouter = Router();

dispositivosRouter.use(requireAuth);

dispositivosRouter.get('/', async (_req, res) => {
  const result = await pool.query('SELECT id, nombre, tipo FROM dispositivos ORDER BY id');
  res.json(result.rows);
});

// Canal servidor -> navegador para reflejar cada reporte del ESP32 sin
// polling. EventSource se reconecta solo si Railway, la red o el navegador
// cortan la conexion. Los comentarios periodicos evitan que un proxy cierre
// una conexion sana por inactividad.
dispositivosRouter.get('/eventos', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const sendState = (update) => {
    res.write(`event: estado\ndata: ${JSON.stringify(update)}\n\n`);
  };
  const unsubscribe = subscribeToDeviceState(sendState);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

dispositivosRouter.post('/:id/comandos', async (req, res) => {
  const { id } = req.params;
  const tipoComando = req.body?.tipo_comando || 'activar';

  const dispositivo = await pool.query('SELECT id FROM dispositivos WHERE id = $1', [id]);
  if (dispositivo.rowCount === 0) {
    return res.status(404).json({ error: 'Dispositivo no encontrado' });
  }

  const result = await pool.query(
    `INSERT INTO comandos (dispositivo_id, tipo_comando, created_by)
     VALUES ($1, $2, $3)
     RETURNING id, created_at`,
    [id, tipoComando, req.session.userId]
  );
  res.status(201).json(result.rows[0]);
});

// Contraparte de lectura de POST /api/device/estado: lo que ultimo reporto
// el dispositivo de si mismo, no un comando que la app le mando.
dispositivosRouter.get('/:id/estado', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(
    'SELECT estado, estado_actualizado_at FROM dispositivos WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Dispositivo no encontrado' });
  }
  res.json(result.rows[0]);
});

// Ultimas activaciones de un dispositivo, con quien y cuando -- el registro
// de auditoria que motivo elegir cuentas reales en vez de un token compartido.
dispositivosRouter.get('/:id/historial', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(
    `SELECT c.id, c.tipo_comando, c.created_at, c.consumido_at, u.nombre AS activado_por
     FROM comandos c
     JOIN usuarios u ON u.id = c.created_by
     WHERE c.dispositivo_id = $1
     ORDER BY c.created_at DESC
     LIMIT 20`,
    [id]
  );
  res.json(result.rows);
});
