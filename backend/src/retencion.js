import { pool } from './db.js';

// El historial de estados no se guarda para siempre: a los 60 dias se borra.
// Ver ADR-0009.
const DIAS_RETENCION = 60;
const INTERVALO_MS = 24 * 60 * 60 * 1000;

// NEO: los graficos muestran como mucho 24 h; 2 dias de margen alcanzan.
const DIAS_SERVIDOR = 2;
// Disyuntor: detalle por minuto 7 dias (grafico del dia). Despues, por cada hora
// quedan solo la ultima lectura (el contador de energia: totales del mes exactos)
// y la de mayor potencia (potencia maxima del dia exacta), mas la primera de
// cada dia: un dia sin dia anterior con datos calcula su consumo desde ahi
// (probado: sin ella el primer dia daba 1,39 kWh en vez de 1,42). ~49 filas/dia
// en vez de ~1440. Ver ADR-0013.
const DIAS_DETALLE_DISYUNTOR = 7;

async function borrarEstadosViejos() {
  const result = await pool.query(
    'DELETE FROM estados WHERE created_at < now() - make_interval(days => $1)',
    [DIAS_RETENCION]
  );
  const servidor = await pool.query(
    `DELETE FROM estados e USING dispositivos d
     WHERE d.id = e.dispositivo_id AND d.tipo = 'servidor'
       AND e.created_at < now() - make_interval(days => $1)`,
    [DIAS_SERVIDOR]
  );
  const disyuntor = await pool.query(
    `WITH viejas AS (
       SELECT e.id,
         row_number() OVER (PARTITION BY e.dispositivo_id, date_trunc('hour', e.created_at)
                            ORDER BY e.created_at DESC) AS por_hora,
         row_number() OVER (PARTITION BY e.dispositivo_id, date_trunc('hour', e.created_at)
                            ORDER BY (e.estado->>'potencia_w')::numeric DESC NULLS LAST) AS por_pico,
         row_number() OVER (PARTITION BY e.dispositivo_id,
                              (e.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
                            ORDER BY e.created_at ASC) AS por_dia
       FROM estados e JOIN dispositivos d ON d.id = e.dispositivo_id
       WHERE d.tipo = 'disyuntor' AND e.created_at < now() - make_interval(days => $1)
     )
     DELETE FROM estados WHERE id IN (
       SELECT id FROM viejas WHERE por_hora > 1 AND por_pico > 1 AND por_dia > 1)`,
    [DIAS_DETALLE_DISYUNTOR]
  );
  const total = result.rowCount + servidor.rowCount + disyuntor.rowCount;
  if (total > 0) {
    console.log(`Retencion: ${result.rowCount} de mas de ${DIAS_RETENCION} dias, `
      + `${servidor.rowCount} de NEO, ${disyuntor.rowCount} del disyuntor compactadas`);
  }
}

// Corre dentro del mismo proceso en vez de usar pg_cron o un servicio de cron
// aparte: el backend ya esta prendido 24/7 (el ESP32 del porton le pega cada
// segundo), asi que no hace falta infraestructura nueva para una consulta por
// dia. Ver ADR-0009.
//
// Se ejecuta tambien al arrancar porque un redeploy reinicia el temporizador:
// sin eso, deploys frecuentes podrian hacer que nunca llegue a correr.
export function iniciarRetencion() {
  const correr = () => borrarEstadosViejos().catch((error) => {
    // Un fallo acá no justifica tumbar el proceso: el historial viejo puede
    // esperar al proximo intento, y lo que importa (recibir reportes del
    // ESP32) sigue funcionando.
    console.error('Fallo la limpieza de estados viejos:', error.message);
  });

  correr();
  setInterval(correr, INTERVALO_MS);
}
