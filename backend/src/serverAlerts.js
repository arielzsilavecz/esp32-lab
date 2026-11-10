import { pool } from './db.js';
import { notifyServerAlert } from './pushNotifications.js';

const UMBRAL_CPU_C = 85;
const SIN_REPORTE_MS = 3 * 60 * 1000;
const COOLDOWN_TEMP_MS = 30 * 60 * 1000;
const REVISION_MS = 60 * 1000;

// En memoria: un redeploy los reinicia, a lo sumo repite una alerta. Escala a
// una sola instancia, igual que stateEvents.js.
const ultimaAlertaTemp = new Map();
const caidos = new Set();

export async function alertarTemperatura(device, estado) {
  const cpu = Number(estado?.cpu_c);
  if (!Number.isFinite(cpu) || cpu < UMBRAL_CPU_C) return;
  const ahora = Date.now();
  if (ahora - (ultimaAlertaTemp.get(device.id) ?? 0) < COOLDOWN_TEMP_MS) return;
  ultimaAlertaTemp.set(device.id, ahora);
  await notifyServerAlert(device.nombre, `CPU a ${cpu.toFixed(1)}°C (umbral ${UMBRAL_CPU_C}°C)`, 'servidor-temperatura');
}

async function revisarSinReporte() {
  const { rows } = await pool.query(
    `SELECT id, nombre, estado_actualizado_at FROM dispositivos
     WHERE tipo = 'servidor' AND estado_actualizado_at IS NOT NULL`
  );
  for (const d of rows) {
    const sinReporte = Date.now() - new Date(d.estado_actualizado_at).getTime() > SIN_REPORTE_MS;
    if (sinReporte && !caidos.has(d.id)) {
      caidos.add(d.id);
      await notifyServerAlert(d.nombre, 'Sin reportar hace más de 3 minutos', 'servidor-caido');
    } else if (!sinReporte && caidos.has(d.id)) {
      caidos.delete(d.id);
      await notifyServerAlert(d.nombre, 'Volvió a reportar', 'servidor-caido');
    }
  }
}

export function iniciarVigilanteServidor() {
  setInterval(() => revisarSinReporte().catch((e) =>
    console.error('Fallo el vigilante de servidor:', e.message)), REVISION_MS);
}
