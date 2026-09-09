# Protocolo del bus DATO — referencia consolidada

Panel: Xanaes 610. Esto es el resumen de referencia de todo lo decodificado hasta
ahora — el detalle experimental de cómo se llegó a cada hallazgo vive en
`docs/captures/xanaes-*.md`, en orden cronológico. Este archivo se actualiza cada vez
que se decodifica algo nuevo; no duplica el relato de cada captura, solo la tabla final.

Ver también `xanaes-dato-wiring.md` (cableado y electricidad) y ADR-0007/0008
(decisiones de diseño del sniffer y del transmisor).

## Eléctrico

- Bus **colector abierto**, pull-up interno ~2.7kΩ hacia +12V (medido, ver ADR-0008).
- Idle en reposo: ~11.4-12.45V (varía un poco entre mediciones, no es motivo de
  alarma).
- 3 hilos: DATO, +12V, GND — mismo cable que alimenta el teclado.

## Tipos de trama en DATO

| Tamaño | Qué es |
|---|---|
| 22 flancos | Una tecla apretada (teclado numérico o botón "casita") |
| 145 flancos | Reporte de estado del panel hacia el teclado (zonas, y algo más sin decodificar) |
| ~125ms de período (fuera de ráfaga) | Latido de fondo constante, presente siempre, no depende de nada |

## Tabla de códigos de tecla (22 símbolos, posiciones 11-17 variables, resto fijo)

| Tecla | Código (7 bits) |
|-------|------------------|
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
| casita | 0101101 (función real no confirmada — ver `docs/captures/xanaes-casita-2026-09-07.md`, con advertencia de seguridad) |

Código fijo confirmado (mismo dígito = mismo código, en sesiones de captura
independientes y en uso real). Símbolo = ancho de pulso clasificado en dos clusters
(~78-83µs=0, ~156-161µs=1); cada pulso individual codifica un bit por su propio ancho,
no es un par PWM (bajo,alto) como el control Garen.

## Tabla de estado de zonas (dentro de la trama de 145 símbolos)

La trama repite un bloque de 12 símbolos cada 32 (dos bloques de 6 contiguos), esa
repetición ocurre 4 veces dentro de la trama:

| Posición dentro del bloque | Zona | Reposo | Activada |
|---|---|---|---|
| 0-1 | Zona 1 (sensor infrarrojo de umbral) | `1,0` | `0,1` |
| 2-3 | Zona 2 | `1,0` | `0,1` |
| 4-5 | Zona 3 | `1,0` | `0,1` |
| 6-7 | Zona 4 | `1,0` | `0,1` |
| 8-9 | Zona 5 | `1,0` | `0,1` |
| 10-11 | Zona 6 | `1,0` | `0,1` |

Posiciones absolutas del primer bloque: 10-21 (repite en 42-53, 74-85, 106-117). No hay
zonas 7-10 en esta instalación (sin expansor) — nada que decodificar ahí.

## Sin decodificar todavía

- **Estado de armado.** Se intentó (`docs/captures/xanaes-armado-2026-09-08.md`) y no
  se encontró un bit estable — lo que cambia parece mezclado con el reloj en tiempo
  real del panel (tiene uno, según el manual), no un flag simple. No es necesario para
  controlar armado/desarmado desde la app (ver ADR-0008) — solo haría falta si se
  quiere *leer* el estado real en vez de que el backend lleve su propio registro.
- El resto de la trama de 145 símbolos más allá del bloque de zonas (nunca cambió en
  ninguna prueba hecha hasta ahora).
