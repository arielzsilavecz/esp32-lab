# ADR-0002: Framework Arduino sobre PlatformIO (en vez de ESP-IDF nativo)

## Estado

Aceptado

## Fecha

2026-07-27

## Contexto

ADR-0001 ya definió PlatformIO como herramienta de build. Falta elegir el *framework*
que corre sobre el chip: `arduino` (arduino-esp32) o `espidf` (ESP-IDF nativo). Esta
decisión condiciona cómo se van a manejar interrupciones y timestamps en la Etapa 3
(captura RF) y qué tan directo es armar el servidor HTTP de la Etapa 7.

## Decisión

`framework = arduino`, `board = esp32dev` (ESP32 WROOM-32 DevKit genérico).

## Alternativas consideradas

- **ESP-IDF nativo** — control total del chip, modelo de tareas FreeRTOS explícito,
  timestamps vía `esp_timer_get_time()`. Rechazado: la precisión de `esp_timer` y de
  `micros()` (ambos ~1µs) es equivalente para pulsos RF de 433 MHz (típicamente
  cientos de µs de ancho), así que no hay ganancia real en este proyecto. A cambio,
  agrega una curva de aprendizaje de FreeRTOS que no es el objetivo (el objetivo es
  entender protocolos RF, no el RTOS), y complica el servidor HTTP de la Etapa 7.
- **Arduino IDE clásico** — ya rechazado en ADR-0001 por falta de gestión de
  dependencias y estructura de tests. No es una alternativa a este ADR, se menciona
  para no confundir "framework Arduino" con "IDE Arduino": acá se usa el framework
  arduino-esp32 corriendo *dentro* de PlatformIO, no el IDE.

## Consecuencias

- La captura RF (Etapa 3) se implementa con `attachInterrupt()` + ISR en `IRAM_ATTR` +
  `micros()`, sin depender de librerías de protocolo (rc-switch u otras) para la
  lógica de captura — coherente con la filosofía de "entender antes de automatizar"
  de `CLAUDE.md`. Esas librerías solo se usan más adelante para *validar* resultados.
- El servidor HTTP (Etapa 7) puede resolverse con `WebServer.h` (síncrono, en la
  librería estándar de arduino-esp32) sin agregar dependencias hasta que haga falta
  algo más (ej. `ESPAsyncWebServer` si el síncrono no alcanza).
- Se pierde acceso directo a algunas primitivas de bajo nivel de ESP-IDF, pero
  arduino-esp32 permite mezclar llamadas a ESP-IDF cuando realmente se necesiten
  (no son mutuamente excluyentes).
