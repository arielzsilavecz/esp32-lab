# ADR-0007: Sniffer de bus del teclado de alarma (`alarm-sniffer/`)

## Estado

Aceptado

## Fecha

2026-09-06

## Contexto

Primer caso de uso del framework fuera de RF 433MHz: interceptar la comunicación entre
el teclado y el panel de un sistema de alarma (línea DATO, ~12V) para eventualmente
entender su protocolo. Mismo ESP32 físico distinto al del portón, y misma técnica base
(captura de flancos por interrupción con timestamp) que ya existía para RF.

## Decisión

**Proyecto PlatformIO nuevo y separado** (`alarm-sniffer/`), no un segundo environment
dentro de `firmware/`. Reusa `hardware::DigitalPin`, `logger::` y — el hallazgo central
de este ADR — **`rf::RfReceiver` tal cual**, vía `lib_extra_dirs` apuntando a
`../firmware/lib`.

`RfReceiver` resultó no tener nada específico de RF en su implementación: es un
capturador de flancos genérico (pin + timestamp + nivel, sesión explícita
`startCapture()`/`stopCapture()`, buffer fijo con detección de overflow). El nombre y la
carpeta (`rf_receiver/`) son un accidente de dónde nació, no de lo que hace. Se reusa sin
tocarle una línea — cero riesgo sobre el firmware del portón, ya validado contra
hardware real.

**Modelo de captura: sesión explícita por comando serial** (`'c'` arranca, `'s'` para y
vuelca), no continuo con auto-volcado por silencio. No se sabe si el bus del teclado
tiene tráfico de polling periódico en reposo; con auto-volcado por silencio eso podría
significar que nunca hay suficiente silencio para volcar, o volcados constantes de puro
ruido de fondo. La sesión explícita, con quien está probando caminando hasta el teclado
real y apretando la tecla, da certeza de qué ventana de tiempo corresponde a qué evento.

**Mismo formato de CSV que el portón** (`index,timestamp_us,duration_us,level`):
`tools/analyze_capture.py` y `compare_captures.py` funcionan sobre esta captura sin
modificarlos.

**Divisor de DATO: 33kΩ (serie) + 10kΩ (a GND)**, dando ~2.79V a partir de una lectura
real de multímetro (~12V estables, no un supuesto). Margen cómodo contra el máximo de
GPIO (3.3V) y por encima del umbral mínimo de nivel alto del ESP32 (~2.47V). Ver
`docs/hardware/xanaes-dato-wiring.md`.

**Solo DATO en esta primera versión**, no ZN1 todavía: menos variables para la primera
prueba contra este panel puntual. Correlacionar con ZN1 (útil para ver qué trama
corresponde a qué zona) queda como extensión futura, una vez validada la captura de un
solo canal.

## Alternativas consideradas

- **Generalizar `RfReceiver`** en un módulo neutro (ej. `edge_capture::EdgeCapture`) en
  vez de reusarlo tal cual desde otro proyecto — más "correcto" nominalmente, pero
  tocaría un archivo ya validado en producción sin necesidad funcional real, solo por
  estética de nombres. Se descarta por ahora; si en algún momento el nombre confunde en
  la práctica, es un rename mecánico, no un rediseño.
- **Segundo environment dentro de `firmware/`** — se descartó porque mezclaría en un
  mismo `platformio.ini` la configuración de dos aplicaciones no relacionadas (porton
  RF vs. sniffer de bus de alarma), y cualquier error de configuración ahí arriesgaría
  el build del porton.
- **Captura continua con auto-volcado por silencio** (como se planteó inicialmente) —
  descartada por el riesgo de tráfico de polling de fondo mencionado arriba.
- **DATO + ZN1 desde el día uno** — descartado para esta primera iteración: se prefiere
  validar un canal contra hardware real antes de sumar la complejidad de correlación
  entre dos.

## Consecuencias

- El repo tiene ahora dos proyectos PlatformIO independientes (`firmware/`,
  `alarm-sniffer/`), compartiendo código vía `lib_extra_dirs` en vez de un monorepo de
  librerías versionado aparte. Si aparece un tercer dispositivo, conviene revisar si
  `lib_extra_dirs` sigue alcanzando o si conviene una carpeta de librerías compartidas
  más explícita (ej. `shared-lib/`).
- Ningún protocolo del bus DATO se asume de antemano — ni siquiera por analogía con
  buses de teclado de otras marcas de alarma. Se descubre empíricamente con la captura,
  igual que se hizo con el Garen.
- Sin GND compartido correcto entre el panel y el ESP32, cualquier lectura de DATO es
  ruido. Ver la nota de puesta a tierra en `docs/hardware/xanaes-dato-wiring.md` antes de
  cablear.
