# esp32-lab — Memoria del proyecto

Este archivo es la memoria persistente del proyecto para cualquier agente (Claude Code u
otro) que trabaje en este repositorio. Se lee al empezar cada sesión. Si algo de lo que
está acá deja de ser cierto, actualizalo en el mismo commit que lo cambia.

## 1. Qué es esto

Una plataforma de experimentación para ESP32 orientada a ingeniería inversa y
automatización de dispositivos de radiofrecuencia de baja potencia (433 MHz como primer
foco). **No es un proyecto para "abrir un portón"**: el portón (control remoto Garen) es
el primer caso de uso de un framework reutilizable que después se aplicará a alarmas,
sensores inalámbricos, NFC y domótica.

Desde 2026-08-18 el repo también incluye `backend/`: un backend propio (Node/Express +
Postgres en Railway) que actúa como centro de mando para dispositivos domóticos —
portón, y a futuro luces, sensores, alarma. No es específico del portón ni de RF: es la
capa de "activar un dispositivo desde el celular, con registro de quién lo hizo", y el
portón es su primer cliente. Ver ADR-0006 para por qué vive en este repo en vez de en uno
separado, y por qué el modelo de datos es genérico (`dispositivos`/`comandos`) y no
`comandos_porton`.

Contexto de autorización: todo el trabajo de RF se hace sobre dispositivos propios del
usuario, en un laboratorio personal, con fines educativos y de automatización doméstica.
Mantené el trabajo dentro de ese alcance (dispositivos propios / con autorización) — no
generalizar hacia captura o control de dispositivos de terceros sin autorización.

## 2. Filosofía (no negociable)

- **Entender antes de automatizar.** Orden siempre: medir → analizar → comprender →
  recién después automatizar. No saltar directo a "reproducir la señal" sin haber
  entendido el protocolo.
- **No depender de librerías que ocultan la lógica** en las primeras etapas. Se pueden
  usar librerías (ej. `rc-switch`) para *validar* resultados propios, pero primero se
  implementa y se entiende el mecanismo a mano.
- Mantenibilidad, claridad, arquitectura y reutilización priman por encima de terminar
  rápido. El objetivo es una plataforma que se reutilice durante años, no un sketch de
  una sola vez.

## 3. Forma de trabajo esperada del agente

- **Antes de implementar cualquier funcionalidad importante**: explicar brevemente el
  enfoque elegido, ventajas/desventajas, alternativas consideradas — y recién después
  implementar. Esto aplica a decisiones de arquitectura, elección de librerías,
  estructura de módulos y protocolos. No aplica a cambios triviales (fix de typo, ajuste
  de nombre, etc.).
- **No hacer cambios silenciosos.** Si se detecta una arquitectura mejor que la
  propuesta, explicarla antes de aplicarla, no reemplazarla sin avisar.
- **Registrar decisiones de arquitectura en `docs/decisions/`** (ADRs) cuando se elige
  una librería, una estructura de carpetas, un protocolo o un enfoque que otro
  desarrollador (o el propio usuario en el futuro) necesitaría entender sin releer todo
  el historial de git. Plantilla en `docs/decisions/0000-adr-template.md`.
- **Git lo maneja el usuario.** No hacer commits, push, ni operaciones de git salvo que
  se pida explícitamente en esa sesión.
- No avanzar de etapa del roadmap (sección 6) sin confirmación del usuario, salvo que
  pida explícitamente saltar etapas.

## 4. Restricciones de ingeniería

- No agregar dependencias innecesarias.
- No usar frameworks pesados si una implementación simple alcanza.
- No sobreingenierizar: no diseñar para requisitos hipotéticos futuros.
- No optimizar prematuramente.
- No escribir cientos de líneas cuando diez resuelven el problema.
- No un único `main.cpp` gigante — arquitectura modular desde el día uno.

## 5. Estilo de código (firmware)

Esta sección es específica de `firmware/` (C++). `tools/` sigue convenciones de Python
estándar (ver `tools/README.md`); `backend/` sigue convenciones de Node/JS estándar
(ver `backend/README.md`).

- C++ moderno, responsabilidad única por módulo/clase.
- Evitar variables globales; const-correctness.
- Comentarios solo cuando aportan un *por qué* no obvio (constraint oculto, workaround,
  invariante). No comentar el *qué* si el nombre ya lo dice.
- Nombres descriptivos, sin abreviaciones innecesarias.
- Separación estricta de responsabilidades:
  - **Hardware** (pines, timers, señales eléctricas)
  - **Drivers** (transmisor/receptor RF, abstracción de periféricos)
  - **Protocolos** (codificación/decodificación, framing)
  - **Aplicación** (casos de uso concretos: portón, alarma, etc.)
  - **Utilidades** (logging, helpers, config)

  No mezclar estas capas dentro de un mismo archivo/clase.

## 6. Arquitectura del repositorio

```
esp32-lab/
├── README.md
├── CLAUDE.md                  # este archivo
├── docs/
│   ├── README.md
│   ├── decisions/              # ADRs — por qué se eligió cada cosa
│   ├── hardware/                # esquemas, pinout, datasheets, notas de cableado
│   └── captures/                # capturas RF exportadas (crudo + análisis)
├── firmware/                   # proyecto PlatformIO (Etapa 1 en adelante)
│   ├── platformio.ini
│   ├── src/
│   ├── include/
│   ├── lib/
│   └── test/
├── tools/                      # scripts de PC (Python, análisis de capturas — Etapa 4)
├── backend/                    # centro de mando de dispositivos (Node/Express + Postgres, Railway)
└── .gitignore
```

`firmware/` es todo lo que corre en el ESP32 en tiempo real (C++). `tools/` es
procesamiento de datos en la PC sobre archivos ya capturados (Python, sin dependencias
externas) — ver ADR-0004 para por qué está separado así. `backend/` es el servicio en la
nube que arbitra comandos entre la app web y los dispositivos (ESP32 y los que se sumen
después) — ver ADR-0006.

## 7. Roadmap

1. **Configuración base**: proyecto PlatformIO, blink, serial monitor, documentación.
2. **Fundaciones**: abstracción de GPIO, helpers, logging, config centralizada.
3. **Captura RF**: lectura por interrupciones, timestamp de flancos, duración de
   pulsos, exportación de capturas. **No decodificar protocolos todavía.**
4. **Análisis de protocolos**: detección automática de ancho de pulso, sincronismo,
   repetición, bits posibles, codificación, estadísticas. **No asumir ningún protocolo
   de antemano.**
5. **Comparación de capturas**: detectar si la trama cambia o es idéntica, cantidad de
   repeticiones, duración promedio, jitter.
6. **Transmisión RF**: reproducir la secuencia capturada tal cual (sin optimizar),
   luego API de transmisión.
7. **Control remoto por app**: en vez de que la ESP32 sirva su propia página (HTTP
   plano, sin PWA instalable posible, requiere IP pública o VPN para acceso remoto), la
   ESP32 hace polling saliente a `backend/` (Node/Express + Postgres en Railway) — sin
   puertos abiertos, funciona igual desde la red local o desde afuera. Ver ADR-0006.

Caso de uso guía para validar cada etapa: control remoto Garen de portón (433 MHz).
Casos futuros: alarmas, sensores inalámbricos, NFC, domótica general — ya no fuera de
alcance, `backend/` está diseñado para ellos desde el modelo de datos (ver ADR-0006).

## 8. Hardware disponible

- ESP32 WROOM-32 (USB-C)
- Receptor 433 MHz MX-05V
- Transmisor 433 MHz FS1000A
- Antenas helicoidales
- PC Windows, VS Code, PlatformIO, Git

## 9. Documentación

- Cada módulo nuevo incluye documentación mínima (qué hace, por qué existe si no es
  obvio).
- `README.md` raíz se actualiza cuando cambia la arquitectura general.
- Decisiones importantes van a `docs/decisions/` (ver sección 3 y `docs/README.md`).
