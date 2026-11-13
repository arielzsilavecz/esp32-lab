import express, { Router } from 'express';
import { pool } from '../db.js';
import { esJpeg, guardarCuadro } from '../camaraCuadros.js';
import { requireDeviceToken } from '../deviceAuth.js';
import { hayPaginasAbiertas, publishDeviceState } from '../stateEvents.js';
import { esperarAviso } from '../esperaComandos.js';
import { notifyCameraAlert, notifyZoneChanges } from '../pushNotifications.js';
import { guardarCaptura, registrarEvento, tomarReforzar, vigilanciaActiva } from '../vigilancia.js';
import { claimCommandSql } from '../commandPolicy.js';
import { alertarTemperatura } from '../serverAlerts.js';
import { debePersistir } from '../historyPolicy.js';

export const deviceRouter = Router();

deviceRouter.use(requireDeviceToken);

// Mantiene viva la conexion TLS del dispositivo. Railway cierra los sockets
// ociosos a los 60s exactos (medido) y rehacer el handshake le cuesta ~1.9s a
// un ESP32, contra ~250ms de una request sobre una conexion ya abierta -- ver
// ADR-0009. requireDeviceToken registra tambien el ultimo contacto en la
// base; no crea snapshots ni eventos de sensores por este heartbeat.
deviceRouter.get('/ping', (_req, res) => {
  // Un body corto obliga al HTTPClient del ESP32 a consumir la respuesta
  // completa antes de conservar el socket. Con 204 dejaba un socket TLS que
  // en la siguiente request aparecia conectado, pero ya no era reutilizable.
  res.status(200).type('text/plain').send('ok');
});

// Cuadro en vivo de una camara (JPEG crudo). Solo llega mientras alguien pidio
// ver; queda en memoria y lo lee GET /api/dispositivos/:id/imagen.
deviceRouter.post('/imagen', express.raw({ type: 'image/jpeg', limit: '400kb' }), (req, res) => {
  if (req.dispositivo.tipo !== 'camara') {
    return res.status(403).json({ error: 'Solo las cámaras suben imágenes' });
  }
  if (!esJpeg(req.body)) {
    return res.status(400).json({ error: 'Se esperaba un JPEG' });
  }
  guardarCuadro(req.dispositivo.id, req.body);
  res.status(204).end();
});

// Linea del registro de vigilancia que no lleva foto (activada, desactivada,
// analisis sin novedad). Las capturas se registran solas al subirse.
deviceRouter.post('/evento', async (req, res) => {
  const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
  if (!texto) return res.status(400).json({ error: 'Falta "texto"' });
  await registrarEvento(req.dispositivo.id, texto);
  res.status(204).end();
});

// Captura de vigilancia (ADR-0015). X-Motivo: "zona" (pedida al activarse
// Z1/Z2: la usa el aviso de zona) o "deteccion" (NEO vio una persona o un
// vehiculo). X-Descripcion, codificada como URI, es el texto del aviso y del
// registro.
deviceRouter.post('/captura', express.raw({ type: 'image/jpeg', limit: '400kb' }), async (req, res) => {
  if (req.dispositivo.tipo !== 'camara') {
    return res.status(403).json({ error: 'Solo las cámaras suben capturas' });
  }
  if (!esJpeg(req.body)) {
    return res.status(400).json({ error: 'Se esperaba un JPEG' });
  }
  const motivo = req.get('X-Motivo');
  if (motivo !== 'zona' && motivo !== 'deteccion') {
    return res.status(400).json({ error: 'X-Motivo debe ser zona o deteccion' });
  }
  let descripcion = motivo === 'zona' ? 'Foto de zona' : 'Movimiento detectado';
  try {
    descripcion = decodeURIComponent(req.get('X-Descripcion') || '').slice(0, 200) || descripcion;
  } catch { /* texto mal codificado: queda el generico */ }

  const id = guardarCaptura(req.body, motivo);
  res.status(204).end();
  void registrarEvento(req.dispositivo.id, motivo === 'deteccion' ? `Aviso: ${descripcion}` : descripcion, id)
    .catch((error) => console.error('No se pudo registrar la captura:', error.message));
  if (motivo === 'deteccion') {
    void notifyCameraAlert(req.dispositivo, descripcion, id)
      .catch((error) => console.error('Fallo el aviso de la camara:', error.message));
  }
});

// La ESP32 llama esto cada ~1s (ver ADR-0006 por que 1s no cambia el costo).
// ?espera=N (hasta 25 s): espera larga. Si no hay orden, la consulta queda
// abierta hasta que llega una o vence (ADR-0013). Sin el parametro responde al
// instante, como siempre: el ESP32 del porton sigue funcionando igual.
// Railway corta sockets ociosos a los 60 s (ADR-0009): 25 s queda lejos.
const ESPERA_MAXIMA_MS = 25_000;

deviceRouter.get('/comando-pendiente', async (req, res) => {
  const reclamar = () => pool.query(claimCommandSql, [req.dispositivo.id]);
  const espera = Math.min(ESPERA_MAXIMA_MS, Math.max(0, Number(req.query.espera) || 0) * 1000);

  let result = await reclamar();
  if (result.rowCount === 0 && espera > 0) {
    const corte = new AbortController();
    res.on('close', () => corte.abort());
    const avisado = await esperarAviso(req.dispositivo.id, espera, corte.signal);
    if (corte.signal.aborted) return;
    if (avisado) result = await reclamar();
  }

  res.set('X-Pagina-Abierta', hayPaginasAbiertas() ? '1' : '0');
  // Camaras: si vigilar (alguien en "Estoy afuera") y si se activo Z1/Z2 (ADR-0015).
  if (req.dispositivo.tipo === 'camara') {
    res.set('X-Vigilancia', (await vigilanciaActiva()) ? '1' : '0');
    const reforzar = tomarReforzar(req.dispositivo.id);
    if (reforzar) res.set('X-Reforzar', reforzar);
  }
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
     SELECT id, estado, estado_actualizado_at FROM actualizado WHERE $3::boolean
     RETURNING dispositivo_id
     )
     SELECT * FROM actualizado`,
    [estado, req.dispositivo.id, debePersistir(req.dispositivo.tipo, req.dispositivo.id, estado)]
  );
  const update = result.rows[0];
  publishDeviceState(update);
  res.json({ ok: true });

  if (update.tipo === 'servidor') {
    void alertarTemperatura(update, update.estado)
      .catch((error) => console.error('Fallo la alerta de temperatura:', error.message));
  }

  // El reporte del ESP32 no debe demorarse ni fallar porque un proveedor Push
  // este caido. La notificacion continua en segundo plano despues del 200.
  void notifyZoneChanges(update, update.estado_anterior, update.estado)
    .catch((error) => console.error('Fallo procesando notificaciones:', error.message));
});
