// El estado "actual" se actualiza y se emite en vivo en cada reporte, pero a
// `estados` (el historial) solo se agrega una fila cuando hay un cambio
// relevante o pasado un intervalo. El disyuntor reporta cada 5 s para el
// vivo: guardarlo todo serian ~17.000 filas/dia por dispositivo.
// Tipos sin politica (alarma, servidor) guardan todo, como siempre.
// cadaMs Infinity = solo cambios: la pagina no muestra historial de luces ni de
// la camara, guardar latidos seria ocupar la base para nada (ADR-0013).
const POLITICA = {
  // 55 s y no 60: sin pagina abierta el puente reporta cada 60 s, y un reporte
  // que llega unos ms antes no debe saltear un minuto del historial.
  disyuntor: { cadaMs: 55_000, claves: ['encendido'] },
  luz: { cadaMs: Infinity, claves: null }, // null: cualquier cambio
  camara: { cadaMs: Infinity, claves: ['transmitiendo'] },
};

// En memoria: tras un redeploy el primer reporte siempre se guarda.
const ultimo = new Map();

export function debePersistir(tipo, id, estado, ahora = Date.now()) {
  const politica = POLITICA[tipo];
  if (!politica) return true;

  const firma = (e) => JSON.stringify(politica.claves ? politica.claves.map((k) => e?.[k]) : e);
  const previo = ultimo.get(id);
  const cambio = !previo || firma(previo.estado) !== firma(estado);
  if (!cambio && ahora - previo.en < politica.cadaMs) return false;

  ultimo.set(id, { en: ahora, estado });
  return true;
}
