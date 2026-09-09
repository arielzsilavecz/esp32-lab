import { Router } from 'express';
import { pool } from '../db.js';
import { requireDeviceToken } from '../deviceAuth.js';
import { publishDeviceState } from '../stateEvents.js';

export const deviceRouter = Router();

deviceRouter.use(requireDeviceToken);

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

  const result = await pool.query(
    `UPDATE dispositivos SET estado = $1, estado_actualizado_at = now()
     WHERE id = $2
     RETURNING id, estado, estado_actualizado_at`,
    [estado, req.dispositivo.id]
  );
  publishDeviceState(result.rows[0]);
  res.json({ ok: true });
});
