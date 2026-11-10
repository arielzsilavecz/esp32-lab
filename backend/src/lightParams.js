// Parametros de la orden "ajustar" de una luz. Se valida aca y otra vez en el
// puente (segunda barrera): la base guarda JSONB libre.
//
// Rangos de los focos CozyLife segun Home Assistant: brillo 1-100 %, blanco
// 2000-6535 K. Blanco y color son modos excluyentes en el foco.
export const TEMPERATURA_MIN_K = 2000;
export const TEMPERATURA_MAX_K = 6535;

const entero = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

export function validarAjusteLuz(parametros) {
  if (!parametros || typeof parametros !== 'object' || Array.isArray(parametros)) {
    return { error: 'Faltan los parámetros del ajuste' };
  }
  const { brillo, temperatura_k: temperatura, color, ...extra } = parametros;
  if (Object.keys(extra).length) return { error: 'Parámetro de luz no reconocido' };
  if (brillo === undefined && temperatura === undefined && color === undefined) {
    return { error: 'El ajuste no cambia nada' };
  }
  if (temperatura !== undefined && color !== undefined) {
    return { error: 'Blanco y color no se pueden pedir juntos' };
  }

  const limpio = {};
  if (brillo !== undefined) {
    if (!entero(brillo, 1, 100)) return { error: 'El brillo debe ser un entero de 1 a 100' };
    limpio.brillo = brillo;
  }
  if (temperatura !== undefined) {
    if (!entero(temperatura, TEMPERATURA_MIN_K, TEMPERATURA_MAX_K)) {
      return { error: `El blanco debe estar entre ${TEMPERATURA_MIN_K} y ${TEMPERATURA_MAX_K} K` };
    }
    limpio.temperatura_k = temperatura;
  }
  if (color !== undefined) {
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
      return { error: 'El color debe tener el formato #rrggbb' };
    }
    limpio.color = color.toLowerCase();
  }
  return { parametros: limpio };
}
