// El estado "actual" se actualiza y se emite en vivo en cada reporte, pero a
// `estados` (el historial) solo se agrega una fila cuando hay un cambio
// relevante o pasado un intervalo. El disyuntor reporta cada 5 s para el
// vivo: guardarlo todo serian ~17.000 filas/dia por dispositivo.
// Tipos sin politica (alarma, servidor) guardan todo, como siempre.
const POLITICA = {
  disyuntor: { cadaMs: 60_000, claves: ['encendido'] },
  luz: { cadaMs: 10 * 60_000, claves: null }, // null: cualquier cambio
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
