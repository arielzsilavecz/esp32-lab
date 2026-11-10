// Ultimo cuadro de cada camara, solo en memoria: no se guarda nada en la base
// ni en disco. NEO sube cuadros unicamente mientras alguien pidio ver en vivo
// (orden "ver"); sin pedido no hay cuadros ni trafico. Ver ADR-0012.
//
// Escala a una sola instancia de Railway, igual que stateEvents.js.
const VIGENCIA_MS = 15_000;
const cuadros = new Map();

export function guardarCuadro(id, imagen) {
  cuadros.set(String(id), { imagen, at: Date.now() });
}

export function leerCuadro(id) {
  const cuadro = cuadros.get(String(id));
  if (!cuadro) return null;
  if (Date.now() - cuadro.at > VIGENCIA_MS) {
    cuadros.delete(String(id));
    return null;
  }
  return cuadro;
}

export function borrarCuadro(id) {
  cuadros.delete(String(id));
}

// Orden "mover" (giro PTZ): una direccion de una lista cerrada. El puente la
// traduce a un pulso corto de ONVIF ContinuousMove + Stop.
export const DIRECCIONES = ['arriba', 'abajo', 'izquierda', 'derecha'];

export function validarMovimiento(parametros) {
  const direccion = parametros?.direccion;
  if (!DIRECCIONES.includes(direccion) || Object.keys(parametros).length !== 1) {
    return { error: 'Dirección de movimiento inválida' };
  }
  return { parametros: { direccion } };
}

// Un JPEG empieza con FF D8. Barrera simple contra subir cualquier cosa.
export function esJpeg(datos) {
  return Buffer.isBuffer(datos) && datos.length > 4 && datos[0] === 0xff && datos[1] === 0xd8;
}
