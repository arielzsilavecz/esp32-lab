# ADR-0003: Diseño del driver de captura RF (`RfReceiver`)

## Estado

Aceptado

## Fecha

2026-08-12

## Contexto

La Etapa 3 pide capturar flancos de un pin digital por interrupción, con timestamp y
duración de pulso, sin decodificar ningún protocolo todavía. Hace falta decidir cómo se
maneja el buffer compartido entre la ISR (que escribe) y el código principal (que
después lee y exporta), sin asumir nada sobre el protocolo del control remoto Garen que
se va a usar para probarlo.

## Decisión

- **Sesión explícita de captura**: `startCapture()` engancha la interrupción y limpia el
  buffer; `stopCapture()` la desengancha. Leer (`count()`, `edgeAt()`, `overflowed()`)
  solo es válido después de `stopCapture()`.
- **Buffer de tamaño fijo** (`Edge buffer_[2048]`, miembro de la clase, sin `new`/heap).
- **Si el buffer se llena antes de `stopCapture()`, se marca `overflowed()`** y se deja
  de escribir — no se sobreescribe el principio de la trama.
- **Cada entrada guarda timestamp absoluto (µs) + nivel**, no la duración calculada. La
  duración se computa después, fuera de la ISR, restando timestamps consecutivos.
- **`main.cpp` abre una ventana de captura fija de 5000 ms** al bootear (`delay()`
  bloqueante dentro de `setup()`), con el LED prendido como indicador visual de "está
  capturando", y exporta el resultado como CSV plano por `Serial` (no por `logger::`,
  que antepone timestamp/nivel/tag a cada línea).

## Alternativas consideradas

- **Buffer circular con lectura concurrente** (la ISR sigue escribiendo mientras el loop
  principal lee) — permitiría captura continua sin sesiones, pero exige secciones
  críticas (`portENTER_CRITICAL`/`portEXIT_CRITICAL`) en cada lectura para evitar razas,
  y no hay ningún caso de uso todavía que necesite "captura infinita en background".
  Rechazada por complejidad sin beneficio real en esta etapa.
- **Buffer dinámico (`new Edge[N]`)** — más flexible en tamaño, pero introduce heap en
  un dispositivo pensado para correr horas/días, con riesgo de fragmentación a largo
  plazo. Rechazada a favor de un array fijo (2048 entradas ≈ 16KB, insignificante frente
  a los 320KB de RAM disponibles).
- **Calcular duración dentro de la ISR** — ahorra una resta en el post-procesamiento,
  pero agrega estado y trabajo a la ISR sin necesidad. Rechazada: mantener la ISR lo más
  chica posible reduce el riesgo de perder flancos si llegan muy rápido.
- **Captura disparada por comando serial** (esperar que el usuario escriba "start" antes
  de capturar) en vez de ventana fija post-boot — más prolijo, pero requiere parsing de
  comandos por Serial que todavía no existe en el proyecto. Se deja para si la ventana
  fija resulta poco práctica en la práctica.

## Consecuencias

- Cada captura requiere resetear la placa (o rehacer boot) para volver a armar la
  ventana — aceptable para esta etapa de laboratorio, incómodo si se usa seguido. Si
  se vuelve un problema real, la salida natural es agregar un comando por Serial para
  rearmar `startCapture()` sin resetear, sin tocar el diseño del driver.
- El formato CSV exportado (`index,timestamp_us,duration_us,level`) es el insumo directo
  para el analizador de protocolos de la Etapa 4 — no se decodifica nada acá, solo se
  deja el dato crudo en un formato fácil de pegar en `docs/captures/`.
