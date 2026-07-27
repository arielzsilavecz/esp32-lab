# ADR-0001: Estructura del repositorio y metodología de trabajo

## Estado

Aceptado

## Fecha

2026-07-27

## Contexto

Este proyecto no busca resolver un único caso de uso (abrir un portón), sino construir
una base de código reutilizable para analizar, comprender, reproducir y controlar
dispositivos RF de baja potencia desde una ESP32, empezando por 433 MHz. El mismo
framework se reutilizará después para alarmas, sensores inalámbricos, NFC y domótica.
Esto exige decidir desde el día uno cómo se organiza el repo y cómo se toman decisiones
de arquitectura, antes de escribir cualquier línea de firmware.

## Decisión

- **Estructura de carpetas** separada por tipo de contenido, no por caso de uso:

  ```
  esp32-lab/
  ├── README.md
  ├── CLAUDE.md
  ├── docs/
  │   ├── decisions/    (ADRs)
  │   ├── hardware/     (pinout, datasheets, notas de cableado)
  │   └── captures/     (capturas RF exportadas)
  └── firmware/          (proyecto PlatformIO: src/include/lib/test)
  ```

- **PlatformIO** en lugar de Arduino IDE, por control de dependencias
  (`platformio.ini`), soporte de tests nativo y estructura de carpetas estándar
  (`src/`, `include/`, `lib/`, `test/`) que fuerza separación de responsabilidades.

- **ADRs en `docs/decisions/`** para cualquier decisión de arquitectura, elección de
  librería o protocolo que no sea obvia leyendo el código o el historial de git. Formato
  Michael Nygard simplificado (plantilla en `0000-adr-template.md`).

- **Dentro de `firmware/`**, separación estricta por capa (no por feature):
  hardware → drivers → protocolos → aplicación → utilidades. Un dispositivo nuevo
  (alarma, NFC) agrega drivers/protocolos/aplicación propios, pero reutiliza
  hardware/utilidades existentes.

- **Metodología por etapas** (roadmap en `CLAUDE.md` §6): captura RF antes que análisis,
  análisis antes que comparación, comparación antes que transmisión. No se decodifica
  ni se asume protocolo antes de tener capturas reales medidas.

## Alternativas consideradas

- **Organizar por caso de uso** (`portón/`, `alarma/`, `nfc/` como carpetas de primer
  nivel) — más simple al principio, pero fomenta duplicar drivers/protocolos en vez de
  reutilizarlos. Rechazada: contradice el objetivo explícito de reutilización.
- **Arduino IDE** — menor fricción inicial, pero sin gestión de dependencias declarativa
  ni estructura de tests. Rechazada por falta de escalabilidad.
- **Un único `main.cpp`** creciendo incrementalmente — más rápido al arrancar, pero
  imposible de mantener modular a medida que se agregan protocolos y dispositivos.
  Rechazada explícitamente por el usuario.
- **No documentar decisiones (sin ADRs)** — menos overhead por decisión individual, pero
  a medida que el proyecto crezca (portón → alarma → NFC → domótica) se perdería el
  motivo detrás de elecciones tempranas. Rechazada: el costo de escribir un ADR es bajo
  comparado con el costo de re-descubrir por qué se eligió algo.

## Consecuencias

- Cada nuevo tipo de dispositivo RF se integra agregando módulos en las capas
  existentes, no una carpeta paralela nueva.
- El repo tiene overhead de documentación (ADRs, docs mínimos por módulo) que se paga
  por adelantado a cambio de no repetir discusiones de diseño más adelante.
- `firmware/` se crea recién en la Etapa 1; hasta entonces el repo solo contiene
  documentación y estructura, sin código de aplicación.
