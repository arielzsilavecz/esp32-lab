import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { subscribeToDeviceState } from '../stateEvents.js';
import { avisarOrden, despertarTodos, dispositivoEsperando } from '../esperaComandos.js';
import { createCommandSql } from '../commandPolicy.js';
import { validarAjusteLuz } from '../lightParams.js';
import { borrarCuadro, leerCuadro, validarMovimiento } from '../camaraCuadros.js';
import { leerCaptura } from '../vigilancia.js';
import { crearClip, eliminarClip, leerClip } from '../camaraClips.js';

// Lista cerrada de comandos por tipo: tipo_comando es texto libre en la base, asi
// que sin esto cualquier sesion podria encolar ordenes arbitrarias.
const COMANDOS_PERMITIDOS = {
  porton: ['activar'],
  luz: ['encender', 'apagar', 'alternar', 'ajustar'],
  disyuntor: ['encender', 'apagar'],
  // ver: transmitir 2 min (o renovarlos); detener: cortar ya; mover: giro PTZ.
  camara: ['ver', 'detener', 'mover'],
  // Orden en lenguaje natural que interpreta el modelo local de NEO. Solo luces
  // (ADR-0014): portón y disyuntor quedan fuera a propósito.
  asistente: ['interpretar'],
};

const TEXTO_MAX = 200;

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
  despertarTodos(); // el puente se entera ya de que hay alguien mirando
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

  // Solo "ajustar" (luz) y "mover" (camara) llevan valores; el resto ignora lo que venga.
  let parametros = null;
  if (tipoComando === 'ajustar' || tipoComando === 'mover') {
    const validar = tipoComando === 'ajustar' ? validarAjusteLuz : validarMovimiento;
    const ajuste = validar(req.body?.parametros);
    if (ajuste.error) return res.status(400).json({ error: ajuste.error });
    parametros = JSON.stringify(ajuste.parametros);
  }
  if (tipoComando === 'interpretar') {
    const texto = typeof req.body?.parametros?.texto === 'string' ? req.body.parametros.texto.trim() : '';
    if (texto.length < 1 || texto.length > TEXTO_MAX) {
      return res.status(400).json({ error: `Escribí entre 1 y ${TEXTO_MAX} caracteres` });
    }
    // Los nombres actuales viajan con la orden: se renombran desde la página y
    // NEO no los tiene.
    const luces = await pool.query(`SELECT id, nombre FROM dispositivos WHERE tipo = 'luz' ORDER BY id`);
    parametros = JSON.stringify({ texto, luces: luces.rows });
  }

  const result = await pool.query(
    createCommandSql,
    [id, tipoComando, req.session.userId, parametros, dispositivoEsperando(id)]
  );
  if (result.rowCount === 0) {
    return res.status(409).json({ error: `${tipo === 'porton' ? 'ESP32' : 'Dispositivo'} sin conexión reciente. La orden no se guardó.` });
  }
  avisarOrden(id); // la espera larga del dispositivo la recibe al instante
  // Al detener, la imagen deja de estar disponible ya, no a los 15 s.
  if (tipo === 'camara' && tipoComando === 'detener') borrarCuadro(id);
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
// Ultimo cuadro en vivo de una camara. ?despues=<ms>: 204 si no hay uno mas
// nuevo (la pagina pregunta seguido y no baja la misma imagen dos veces).
dispositivosRouter.get('/:id/imagen', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const cuadro = leerCuadro(req.params.id);
  // 204 tambien sin cuadro: mientras NEO arranca "todavia no hay" no es un error.
  if (!cuadro || cuadro.at <= (Number(req.query.despues) || 0)) return res.status(204).end();
  res.set('X-Capturada', String(cuadro.at)).type('image/jpeg').send(cuadro.imagen);
});

dispositivosRouter.post('/:id/eventos/:eventoId/clip', async (req, res) => {
  const desplazamiento = req.body?.desplazamiento ?? 0;
  if (!Number.isInteger(desplazamiento) || Math.abs(desplazamiento) > 3600) {
    return res.status(400).json({ error: 'Desplazamiento inválido' });
  }
  const evento = await pool.query(`SELECT e.created_at, e.ocurrido_en FROM eventos e
    JOIN dispositivos d ON d.id = e.dispositivo_id
    WHERE d.tipo = 'camara' AND d.id = $1 AND e.id = $2`, [req.params.id, req.params.eventoId]);
  if (!evento.rowCount) return res.status(404).json({ error: 'Registro no encontrado' });
  const clipId = crearClip(req.params.id);
  if (!clipId) return res.status(409).json({ error: 'Hay videos en preparación. Probá más tarde.' });
  const fecha = new Date(evento.rows[0].ocurrido_en ?? evento.rows[0].created_at);
  fecha.setUTCSeconds(fecha.getUTCSeconds() + desplazamiento);
  const parametros = JSON.stringify({ clip_id: clipId, fecha });
  const orden = await pool.query(createCommandSql,
    [req.params.id, 'clip', req.session.userId, parametros, dispositivoEsperando(req.params.id)]);
  if (!orden.rowCount) {
    leerClip(clipId, req.params.id).error = 'La cámara no está conectada.';
    return res.status(409).json({ error: 'La cámara no está conectada' });
  }
  avisarOrden(req.params.id);
  res.status(202).json({ id: clipId });
});

dispositivosRouter.get('/:id/clips/:clipId', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const clip = leerClip(req.params.clipId, req.params.id);
  if (!clip) return res.status(404).json({ error: 'El video venció o no existe' });
  if (clip.error) return res.status(404).json({ error: clip.error });
  if (!clip.video) return res.status(204).end();
  res.type('video/mp4').send(clip.video);
  eliminarClip(req.params.clipId);
});

// Consumo por dia de un mes (vista mensual del disyuntor): ?mes=YYYY-MM.
// kWh del dia = ultimo contador del dia menos el ultimo del dia anterior con
// datos (lag), asi no se pierde el consumo entre la ultima lectura de un dia y
// la primera del siguiente. Se lee un dia antes del mes solo como base.
// GREATEST(0, ...) evita negativos si el medidor se reinicia.
dispositivosRouter.get('/:id/consumo', async (req, res) => {
  const mes = req.query.mes;
  if (typeof mes !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    return res.status(400).json({ error: 'mes debe ser YYYY-MM' });
  }
  const result = await pool.query(
    `WITH lecturas AS (
       SELECT (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS dia,
              (estado->>'energia_kwh')::numeric AS energia,
              (estado->>'potencia_w')::numeric AS potencia
       FROM estados
       WHERE dispositivo_id = $1 AND estado ? 'energia_kwh'
         AND created_at >= ($2::date - 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'
         AND created_at < (($2::date + interval '1 month')::date)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'
     ), dias AS (
       SELECT dia, min(energia) AS inicio, max(energia) AS fin, max(potencia) AS potencia_max
       FROM lecturas GROUP BY dia
     ), consumo AS (
       SELECT dia, GREATEST(0, fin - COALESCE(lag(fin) OVER (ORDER BY dia), inicio)) AS kwh, potencia_max
       FROM dias
     )
     SELECT to_char(dia, 'YYYY-MM-DD') AS dia, round(kwh, 3)::float AS kwh, potencia_max::float AS potencia_max_w
     FROM consumo WHERE dia >= $2::date ORDER BY dia`,
    [req.params.id, `${mes}-01`]
  );
  res.json(result.rows);
});

// Registro de vigilancia de una camara, un dia en hora de Argentina (?fecha,
// hoy si no viene), mas nuevo primero. `foto` solo mientras la captura siga en
// memoria (hasta 24 h): despues la linea queda sin foto.
dispositivosRouter.get('/:id/eventos', async (req, res) => {
  const fecha = req.query.fecha ?? null;
  if (fecha !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'fecha debe ser YYYY-MM-DD' });
  }
  res.set('Cache-Control', 'no-store');
  const result = await pool.query(
    `WITH dia AS (
       SELECT d::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires' AS desde,
              (d + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires' AS hasta
       FROM (SELECT COALESCE($2::date,
         (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) AS d) f
     )
     SELECT id, texto, captura, created_at, ocurrido_en FROM eventos, dia
     WHERE dispositivo_id = $1 AND COALESCE(ocurrido_en, created_at) >= dia.desde
       AND COALESCE(ocurrido_en, created_at) < dia.hasta
     ORDER BY COALESCE(ocurrido_en, created_at) DESC`,
    [req.params.id, fecha]
  );
  res.json(result.rows.map(({ id, texto, captura, created_at, ocurrido_en }) => ({
    id,
    texto,
    created_at,
    ocurrido_en,
    foto: captura && leerCaptura(captura) ? `/capturas/${captura}.jpg` : null,
  })));
});

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
