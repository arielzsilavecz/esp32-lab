import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { subscribeToDeviceState } from '../stateEvents.js';
import { createCommandSql } from '../commandPolicy.js';

// Lista cerrada de comandos por tipo: tipo_comando es texto libre en la base, asi
// que sin esto cualquier sesion podria encolar ordenes arbitrarias.
const COMANDOS_PERMITIDOS = {
  porton: ['activar'],
  luz: ['encender', 'apagar', 'alternar'],
  disyuntor: ['encender', 'apagar'],
};

export const dispositivosRouter = Router();

dispositivosRouter.use(requireAuth);

dispositivosRouter.get('/', async (_req, res) => {
  const result = await pool.query('SELECT id, nombre, tipo FROM dispositivos ORDER BY id');
  res.json(result.rows);
});

// Renombrar desde la pagina: solo focos, porque se mueven de lugar. Portón,
// alarma, disyuntor y NEO son fijos. Solo el nombre: tipo y token no se tocan.
dispositivosRouter.patch('/:id', async (req, res) => {
  const nombre = typeof req.body?.nombre === 'string' ? req.body.nombre.trim().replace(/\s+/g, ' ') : '';
  if (nombre.length < 1 || nombre.length > 40) {
    return res.status(400).json({ error: 'El nombre debe tener entre 1 y 40 caracteres' });
  }
  const result = await pool.query(
    `UPDATE dispositivos SET nombre = $1 WHERE id = $2 AND tipo = 'luz' RETURNING id, nombre`,
    [nombre, req.params.id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Foco no encontrado' });
  }
  res.json(result.rows[0]);
});

dispositivosRouter.get('/conexion', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const result = await pool.query(`
    SELECT id, last_seen_at,
      COALESCE(last_seen_at > clock_timestamp() -
        CASE WHEN tipo = 'porton' THEN interval '10 seconds' ELSE interval '90 seconds' END,
        false) AS conectado
    FROM dispositivos ORDER BY id`);
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

  const dispositivo = await pool.query('SELECT id, tipo FROM dispositivos WHERE id = $1', [id]);
  if (dispositivo.rowCount === 0) {
    return res.status(404).json({ error: 'Dispositivo no encontrado' });
  }

  const tipo = dispositivo.rows[0].tipo;
  const permitidos = COMANDOS_PERMITIDOS[tipo];
  if (permitidos && !permitidos.includes(tipoComando)) {
    return res.status(400).json({ error: `Comando de ${tipo} no permitido` });
  }

  // Abrir el porton o cortar el disyuntor (conectar no exige biometria).
  const requiereBiometria = (tipo === 'porton' && tipoComando === 'activar')
    || (tipo === 'disyuntor' && tipoComando === 'apagar');
  if (requiereBiometria) {
    const autorizacion = req.session.portonAuthorization;
    delete req.session.portonAuthorization;
    if (!autorizacion
        || autorizacion.dispositivoId !== String(id)
        || autorizacion.expiresAt < Date.now()) {
      return res.status(403).json({ error: 'Se requiere verificación biométrica' });
    }
  }

  const result = await pool.query(
    createCommandSql,
    [id, tipoComando, req.session.userId]
  );
  if (result.rowCount === 0) {
    return res.status(409).json({ error: `${tipo === 'porton' ? 'ESP32' : 'Dispositivo'} sin conexión reciente. La orden no se guardó.` });
  }
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

// Snapshots historicos de lo que fue reportando el dispositivo, mas nuevo
// primero. Devuelve el estado crudo: que una zona "se activo" es una
// transicion entre dos snapshots, y derivarla es trabajo de la pagina -- el
// backend sigue sin saber que es una zona (mismo criterio que ADR-0006).
//
// ?fecha=YYYY-MM-DD devuelve el dia completo en hora de Argentina (hoy si no
// viene), mas el ultimo snapshot anterior a ese dia: sin el, la primera
// transicion del dia no tendria contra que compararse.
dispositivosRouter.get('/:id/estados', async (req, res) => {
  const { id } = req.params;
  const fecha = req.query.fecha ?? null;
  if (fecha !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'fecha debe ser YYYY-MM-DD' });
  }

  // ?horas=1|24: ventana movil hasta ahora (graficos del servidor). Un dia
  // calendario cortaria "la ultima hora" a medianoche.
  if (req.query.horas !== undefined) {
    const horas = Number(req.query.horas);
    if (horas !== 1 && horas !== 24) {
      return res.status(400).json({ error: 'horas debe ser 1 o 24' });
    }
    const ventana = await pool.query(
      `SELECT estado, created_at FROM estados
       WHERE dispositivo_id = $1 AND created_at > now() - make_interval(hours => $2)
       ORDER BY created_at DESC`,
      [id, horas]
    );
    return res.json(ventana.rows);
  }

  const result = await pool.query(
    `WITH dia AS (
       SELECT d::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires' AS desde,
              (d + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires' AS hasta
       FROM (SELECT COALESCE($2::date,
         (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) AS d) f
     )
     SELECT estado, created_at FROM estados, dia
     WHERE dispositivo_id = $1 AND created_at >= dia.desde AND created_at < dia.hasta
     UNION ALL
     (SELECT estado, created_at FROM estados, dia
      WHERE dispositivo_id = $1 AND created_at < dia.desde
      ORDER BY created_at DESC LIMIT 1)
     ORDER BY created_at DESC`,
    [id, fecha]
  );
  res.json(result.rows);
});

// Ultimas activaciones de un dispositivo, con quien y cuando -- el registro
// de auditoria que motivo elegir cuentas reales en vez de un token compartido.
dispositivosRouter.get('/:id/historial', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(
    `SELECT c.id, c.tipo_comando, c.created_at, c.consumido_at, c.expires_at,
       c.delivered_at, u.nombre AS activado_por
     FROM comandos c
     JOIN usuarios u ON u.id = c.created_by
     WHERE c.dispositivo_id = $1
     ORDER BY c.created_at DESC
     LIMIT 20`,
    [id]
  );
  res.json(result.rows);
});
