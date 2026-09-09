# Captura — las 12 teclas del teclado Xanaes — 2026-09-07

- **Archivo**: `xanaes-teclas-completas-2026-09-07.csv` (8192 flancos, desbordó el
  buffer al final — el volcado alcanza hasta poco después de apretar `#`, la última
  tecla, así que no falta nada relevante).
- **Secuencia real apretada**: `1,2,3,4,5,6,7,8,9,*,0,#` (arrancó repitiendo 1,2,3 por
  error de comunicación de la sesión anterior, no cambia el resultado).
- **Sesión anterior** (`xanaes-teclas-123-2026-09-07.csv`) capturó las mismas teclas
  1,2,3 por separado, en un boot distinto — se usa acá para validar código fijo.

## Código fijo confirmado

Las teclas 1, 2 y 3 dan **exactamente el mismo código de 7 bits** en las dos sesiones
(arranques y momentos distintos). Mismo tipo de validación que con el control Garen
antes de confiar en el replay.

## Tabla de códigos (posiciones 11-17 de la trama de 22 símbolos)

| Tecla | Código |
|-------|--------|
| 1 | 1010100 |
| 2 | 1010011 |
| 3 | 1010010 |
| 4 | 1001101 |
| 5 | 1001100 |
| 6 | 1001011 |
| 7 | 1001010 |
| 8 | 0110101 |
| 9 | 0110100 |
| * | 0110011 |
| 0 | 1010101 |
| # | 0110010 |

Posiciones 0-10 y 18-21 son **idénticas en las 12 teclas** — preámbulo/sufijo fijo del
teclado, no dependen de qué se apretó.

Símbolo = ancho de pulso clasificado en dos clusters (~78-83µs = 0, ~156-161µs = 1),
independiente del nivel (alto/bajo) — no es un par PWM (bajo,alto) como el Garen, cada
pulso individual codifica un bit por su propio ancho.

## No se explica el esquema de numeración

No es un binario simple correlativo (1≠0001, 2≠0010, etc.) — parece un ID de tecla
propio del fabricante, agrupado de a 4 con un patrón que se repite (los últimos 3 bits
ciclan entre 4 valores fijos: 100,011,010,101). No hace falta entender el porqué para
usar la tabla — alcanza con que sea estable y reproducible, que ya está confirmado.

## Pendiente

- Validar más teclas repetidas (ideal: las 12, no solo 1-2-3) en una tercera sesión,
  para blindar la confianza en la tabla completa, no solo en 1-2-3.
- Las ráfagas largas (LED/display, ~4.5s después de cada tecla) siguen sin decodificar
  y no parecen depender de la tecla apretada (ver captura anterior).
