// Vigilancia de camaras (ADR-0015). La deteccion corre en NEO; aca solo:
//  - si algun navegador esta en "Estoy afuera" (manual o por horario): NEO lo
//    lee como cabecera de su espera de ordenes, sin consultas extra;
//  - pedir una captura al activarse Z1/Z2 y esperarla unos segundos para que
//    el aviso de zona salga con la foto;
//  - guardar las capturas 6 h detras de un id aleatorio: la notificacion las
//    muestra sin sesion (el telefono pide la imagen sin cookies).
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { pool } from './db.js';
import { avisarOrden } from './esperaComandos.js';

// Condicion "este navegador esta en Estoy afuera ahora" sobre push_subscriptions
// con alias `s`. Horario en su zona horaria; admite periodos que cruzan
// medianoche (el dia que cuenta es el de inicio del periodo).
const hora = (s) => `(now() AT TIME ZONE ${s}.schedule_timezone)::time`;
const dia = (s) => `EXTRACT(ISODOW FROM now() AT TIME ZONE ${s}.schedule_timezone)::int`;
export const suscripcionActiva = (s) => `(
  ${s}.enabled = true
  OR (${s}.schedule_enabled = true AND (
    (${s}.schedule_start < ${s}.schedule_end
     AND ${dia(s)} = ANY(${s}.schedule_days)
     AND ${hora(s)} >= ${s}.schedule_start AND ${hora(s)} < ${s}.schedule_end)
    OR
    (${s}.schedule_start > ${s}.schedule_end
     AND ((${hora(s)} >= ${s}.schedule_start AND ${dia(s)} = ANY(${s}.schedule_days))
          OR (${hora(s)} < ${s}.schedule_end AND ((${dia(s)} + 5) % 7) + 1 = ANY(${s}.schedule_days))))
  ))
)`;

export async function vigilanciaActiva() {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM push_subscriptions s WHERE ${suscripcionActiva('s')}) AS activa`);
  return rows[0].activa;
}

// --- Pedido de captura (Z1/Z2) ----------------------------------------------
// En memoria, como esperaComandos: una sola instancia de Railway.
const reforzar = new Set();
const capturas = new EventEmitter();

// La proxima respuesta de ordenes de esa camara lleva X-Reforzar: 1.
export function tomarReforzar(camaraId) {
  return reforzar.delete(String(camaraId));
}

// Despierta a las camaras y resuelve con el id de la primera captura de zona
// que llegue, o null a los `ms`.
export async function pedirCaptura(ms) {
  const { rows } = await pool.query(`SELECT id FROM dispositivos WHERE tipo = 'camara'`);
  if (rows.length === 0) return null;
  return new Promise((resolve) => {
    const listo = (id) => { clearTimeout(reloj); resolve(id); };
    const reloj = setTimeout(() => { capturas.off('zona', listo); resolve(null); }, ms);
    capturas.once('zona', listo);
    for (const { id } of rows) {
      reforzar.add(String(id));
      avisarOrden(id);
    }
  });
}

// --- Almacen de capturas ----------------------------------------------------
const VIGENCIA_MS = 6 * 60 * 60 * 1000;
const MAXIMO = 200; // ~35 KB c/u: tope de ~7 MB de memoria
const guardadas = new Map();

export function guardarCaptura(imagen, motivo) {
  const ahora = Date.now();
  for (const [id, captura] of guardadas) {
    if (ahora - captura.at > VIGENCIA_MS || guardadas.size >= MAXIMO) guardadas.delete(id);
    else break; // Map en orden de insercion: el resto es mas nuevo
  }
  const id = crypto.randomBytes(16).toString('hex');
  guardadas.set(id, { imagen, at: ahora });
  if (motivo === 'zona') capturas.emit('zona', id);
  return id;
}

export function leerCaptura(id) {
  const captura = guardadas.get(id);
  return captura && Date.now() - captura.at <= VIGENCIA_MS ? captura : null;
}
