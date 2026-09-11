import { pool } from './db.js';

// El historial de estados no se guarda para siempre: a los 60 dias se borra.
// Ver ADR-0009.
const DIAS_RETENCION = 60;
const INTERVALO_MS = 24 * 60 * 60 * 1000;

async function borrarEstadosViejos() {
  const result = await pool.query(
    'DELETE FROM estados WHERE created_at < now() - make_interval(days => $1)',
    [DIAS_RETENCION]
  );
  if (result.rowCount > 0) {
    console.log(`Retencion: borrados ${result.rowCount} estados de mas de ${DIAS_RETENCION} dias`);
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
