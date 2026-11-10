// "Espera larga" de ordenes: el dispositivo pregunta una vez y la consulta queda
// abierta hasta que aparece una orden (o vence). Reemplaza preguntar cada 1 s:
// ~25 veces menos consultas y la orden llega al instante. Ver ADR-0013.
//
// En memoria: escala a una sola instancia de Railway, igual que stateEvents.js.
import { EventEmitter } from 'node:events';

const avisos = new EventEmitter();
avisos.setMaxListeners(0);
const TODOS = '*';
const esperando = new Map();

// Un dispositivo con una espera abierta esta presente aunque su ultimo contacto
// tenga mas de 10 s: el chequeo de presencia de las ordenes lo usa.
export function dispositivoEsperando(id) {
  return (esperando.get(String(id)) ?? 0) > 0;
}

// Resuelve true si llega un aviso (orden nueva o despertar general) y false al
// vencer o si se corta la conexion (senal).
export function esperarAviso(id, ms, senal) {
  const clave = String(id);
  esperando.set(clave, (esperando.get(clave) ?? 0) + 1);
  return new Promise((resolve) => {
    let reloj = null;
    const terminar = (valor) => {
      clearTimeout(reloj);
      avisos.off(clave, alAviso);
      avisos.off(TODOS, alAviso);
      senal?.removeEventListener('abort', alCortar);
      const restantes = (esperando.get(clave) ?? 1) - 1;
      if (restantes > 0) esperando.set(clave, restantes);
      else esperando.delete(clave);
      resolve(valor);
    };
    const alAviso = () => terminar(true);
    const alCortar = () => terminar(false);
    if (senal?.aborted) {
      terminar(false);
      return;
    }
    reloj = setTimeout(() => terminar(false), ms);
    avisos.once(clave, alAviso);
    avisos.once(TODOS, alAviso);
    senal?.addEventListener('abort', alCortar, { once: true });
  });
}

export function avisarOrden(id) {
  avisos.emit(String(id));
}

// Se abre una pagina: las esperas responden ya, para que el puente se entere
// de que hay alguien mirando (cabecera X-Pagina-Abierta) sin esperar 25 s.
export function despertarTodos() {
  avisos.emit(TODOS);
}
