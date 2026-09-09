# Captura — teclas 1, 2, 3 del teclado Xanaes — 2026-09-07

- **Archivo**: `xanaes-teclas-123-2026-09-07.csv`
- **Hardware**: `alarm-sniffer/` (ESP32 separado), divisor 33k+10k en DATO → GPIO34.
  Ver `docs/hardware/xanaes-dato-wiring.md`.
- **Procedimiento**: una sesión de captura continua (`c` ... `s`), apretando 1, 2 y 3 en
  el teclado real, esperando el beep de confirmación entre cada una. 2244 flancos,
  26.5 segundos.

## El bus nunca está en silencio

Confirmado empíricamente lo que solo era sospecha al elegir sesión explícita en vez de
auto-volcado por silencio (ADR-0007): DATO tiene un latido de fondo constante, un pulso
cada ~125ms (alto ~3900µs + bajo ~121100µs), presente todo el tiempo sin importar si se
aprieta algo. Es casi seguro el polling del panel hacia el teclado.

## Estructura por cada tecla apretada

Cada pulsación produce dos eventos bien diferenciados, separables por umbral de
duración (>2000µs = hueco/latido, <2000µs = ráfaga):

1. **Una ráfaga corta** (22 flancos, ~2.8ms), inmediatamente al apretar.
2. **Un grupo de 4 ráfagas largas idénticas** (145 flancos, ~18ms cada una, muy pegadas
   entre sí), que aparece consistentemente **~4.5 segundos después** de la ráfaga corta.

## Hallazgo: la ráfaga corta lleva el código de tecla

Comparando las tres ráfagas cortas (una por tecla) símbolo a símbolo (clusters de ancho
de pulso, no microsegundos crudos — igual que con el Garen, porque comparar por
duración exacta da "distintas" hasta entre repeticiones de la misma tecla por el
jitter):

- Posiciones 0-14 y 18-21: **idénticas en las tres teclas** — preámbulo/sync fijo.
- Posiciones 15-17: **cambian según la tecla apretada** — candidato fuerte a ser el
  código de tecla en sí.

Anchos de pulso reales en esa ventana (nivel, µs):

| Tecla | pos 15 | pos 16 | pos 17 |
|-------|--------|--------|--------|
| 1     | ~156   | ~80    | ~78    |
| 2     | ~78    | ~157   | ~156   |
| 3     | ~78    | ~157   | ~78    |

No se decodifica más allá de esto todavía — sería asumir una convención de bit sin
haber visto suficientes teclas para confirmarla.

## Las ráfagas largas NO dependen de la tecla

La primera repetición del grupo de 4 es **idéntica bit a bit entre las tres teclas**.
No es información del dígito apretado — probablemente un refresco periódico de
display/LEDs del panel que ocurre con un retardo fijo tras cualquier interacción, no
un reporte del valor presionado. Dentro de un mismo grupo de 4, las repeticiones 0-1
difieren levemente de las 2-3 en un patrón que se repite cada ~36-37 símbolos
(compatible con multiplexado de un display, a confirmar).

## Qué falta para tener certeza

- Capturar las teclas restantes (4-9, 0, `*`, `#`) para ver si la ventana de 3 símbolos
  varía de forma consistente con un patrón (binario, BCD, u otro) a través de los 10+
  valores posibles.
- Repetir la misma tecla más de una vez en capturas separadas, para confirmar que el
  código es estable (fijo) y no cambia — mismo tipo de verificación que se hizo con el
  control Garen antes de asumir código fijo.
