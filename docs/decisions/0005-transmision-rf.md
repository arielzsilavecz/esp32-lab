# ADR-0005: Diseño del transmisor RF (`RfTransmitter`)

## Estado

Aceptado

## Fecha

2026-08-15

## Contexto

La Etapa 6 pide reproducir la secuencia capturada. Para cuando se llegó acá, el
análisis de las capturas (ver `docs/captures/garen-boton-2026-08-15-fijo-vs-rolling.md`)
ya había establecido que el control Garen usa **código fijo** y que la trama es
1 pulso de sync + 28 bits en PWM de período constante (1429µs). Eso abre una opción
que el roadmap original no contemplaba: transmitir desde los bits en vez de reproducir
un array de tiempos.

## Decisión

**Transmisión parametrizada.** `RfTransmitter` genera la onda desde
`(código, cantidad de bits, PwmTiming)`, no desde una lista de duraciones capturada.

**`PwmTiming` lleva cuatro tiempos independientes**, no un "corto" y un "largo" que se
intercambian:

```
bit 1 = (bajo 1022µs, alto 407µs)
bit 0 = (bajo  545µs, alto 884µs)
```

Ambos suman 1429µs, pero 1022 ≠ 884 y 407 ≠ 545. Un modelo de dos tiempos generaría
una onda que **no** es la capturada. Esto se descubrió midiendo: al calcular las
estadísticas de "pulso corto" y "pulso largo" agrupando ambos bits, las desviaciones
saltaron a 72µs contra los ~21µs de cada tiempo por separado — la señal de que cada
grupo era en realidad bimodal.

**Bit-banging con `delayMicroseconds()`** como primera implementación, no el periférico
RMT.

**Las constantes del Garen viven en la capa de aplicación** (`main.cpp`), no en
`Config.h` ni en el driver: son conocimiento de un dispositivo concreto, y meterlas en
la configuración general mezclaría capas (ADR-0001). `Config.h` solo lleva el pin.

## Alternativas consideradas

- **Replay crudo del array de tiempos** — más simple y es lo que sugería el roadmap
  ("primero sin optimizar"). Rechazada porque el análisis ya estaba hecho: con los bits
  decodificados, el driver parametrizado cuesta prácticamente lo mismo y sirve para
  cualquier control de esta familia cambiando constantes, que es el objetivo de
  framework reutilizable del proyecto. El replay crudo queda igual como **test de
  regresión**: si la onda generada y la capturada coinciden, la decodificación es
  correcta.
- **Periférico RMT del ESP32** — genera trenes de pulsos por hardware, sin jitter de
  CPU ni sensibilidad a interrupciones. Es la solución técnicamente superior y no
  violaría la filosofía del proyecto (es un periférico, misma categoría que un timer,
  no una librería que oculta el protocolo). Pospuesta deliberadamente: primero
  bit-banging para entender el timing y **medir** el jitter real, y migrar solo si
  molesta. Coincide con "medir → comprender → recién después optimizar".
- **Deshabilitar interrupciones durante la transmisión** para reducir jitter —
  rechazada: una trama dura ~51ms y diez repeticiones medio segundo. Cortar
  interrupciones ese tiempo en un ESP32 con FreeRTOS dispara el watchdog.

## Consecuencias

- `send()` es **bloqueante**: ~515ms para 10 repeticiones. Aceptable mientras la
  aplicación sea "mandar y listo"; cuando entre el servidor HTTP (Etapa 7) habrá que
  decidir si se transmite desde el handler o desde una tarea aparte.
- **Medido el 2026-08-18** (loopback por cable, GPIO32→GPIO34; ver
  `docs/captures/esp32-tx-generada-2026-08-18.md`): el bit-banging genera pulsos con
  desviación **submicrosegundo** (σ entre 0.1 y 0.9µs según el pulso). La onda generada
  produce una secuencia de símbolos **idéntica** a la del control original. **Queda
  cerrada la migración a RMT: no hace falta.**
- Hay un sesgo sistemático de **+5µs por pulso** (overhead de `digitalWrite()` más el
  del lazo, sumado a cada `delayMicroseconds()`): período 1439.2µs generado contra
  1429.0µs del original. Es 1% sobre pulsos de 500µs y el propio control varía ±50µs
  entre repeticiones, así que no se compensa — sería optimizar sin necesidad demostrada.
- **El firmware no transmite en el arranque**, a propósito: enchufar el USB no debe
  abrir el portón. La transmisión se dispara por comando serial (`t`), con `l` para el
  loopback de validación.
- Si aparece un segundo dispositivo RF con otra codificación (no PWM de período
  constante), `PwmTiming` no va a alcanzar y habrá que introducir una abstracción de
  protocolo por encima del driver. No se diseña ahora por no anticipar requisitos
  hipotéticos.
