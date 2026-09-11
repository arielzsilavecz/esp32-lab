# ADR-0009: Estado en vivo de zonas de la alarma en la página del portón

## Estado

Implementado.

## Fecha

2026-09-09

## Contexto

Con las 6 zonas ya decodificadas (`docs/hardware/xanaes-dato-protocol.md`) y el intento
de escritura sobre DATO descartado (ADR-0008 sigue siendo válido como diseño, pero en la
práctica no logró hacer reaccionar al panel — el usuario prefiere dejarlo así: "es mas
seguro si no se puede"), el siguiente paso útil es solo **lectura**: ver el estado de las
zonas desde la misma página que ya controla el portón, no una página aparte.

## Decisión

**Captura periódica, no un buffer circular continuo.** `RfReceiver` es de una sola
sesión (start→stop→leer), pensado para "grabar unos segundos y volcar" — no para correr
24/7. En vez de reescribir esa clase compartida (usada también por el portón, ya
validada en producción) para que sea un ring buffer, el firmware del sniffer encadena
ventanas de 200ms, busca la trama de 145 símbolos con los umbrales ya medidos (nada de
clustering adaptativo — el protocolo ya está entendido) y decodifica las 6 zonas. La
trama dura ~18ms y el panel repite cada reporte 125ms después: 143ms es el mínimo
teórico para asegurar una copia completa ante cualquier alineación de la ventana, y
200ms deja margen. Si no aparece, el siguiente ciclo empieza de inmediato.

**Captura y HTTPS en tareas separadas.** Una zona puede volver a reposo mientras el
POST del estado activo todavía está esperando la red. Detener la captura durante ese
round-trip pierde la trama de reposo para siempre porque el panel no la retransmite
periódicamente. El lazo principal captura y decodifica sin depender de WiFi; una tarea
FreeRTOS consume una cola de un elemento, que conserva siempre el estado más reciente,
y reintenta el POST hasta entregarlo.

**Nunca se decodifican ni transmiten códigos de tecla en este camino.** El decodificador
de zonas (`xanaes::decodeZoneStatus`) solo mira las posiciones fijas del bloque de
zonas — no tiene forma de exponer qué tecla se apretó ni la clave de usuario, ni por
error. Importa porque esta página es deliberadamente accesible desde fuera de la red de
casa (ese es su propósito, ver ADR-0006): un log o vista en vivo de teclas presionadas
sería exponer la clave del sistema de seguridad a quien vea la página.

**Estado genérico en `dispositivos`, no una tabla de historial.** Columnas
`estado JSONB` + `estado_actualizado_at`, igual criterio que `dispositivos.tipo`: sin
shape fijo, cualquier tipo de dispositivo futuro puede reportar lo que le sirva. No es
una tabla de eventos (`comandos` sí lo es, con motivo de auditoría real) porque acá solo
interesa el último valor, no quién lo cambió.

**Alarma es un dispositivo más de `dispositivos`**, con su propio token — mismo modelo
que el portón, no un sistema aparte. Endpoints: `POST /api/device/estado` (dispositivo →
backend, autenticado por token) y `GET /api/dispositivos/:id/estado` (página → backend,
autenticado por sesión). La página distingue el layout por `tipo === 'alarma'`.

**Conexión TLS mantenida tibia con un ping cada 45s.** Medido: Railway cierra la
conexión ociosa a los **60s exactos**, y rehacer el handshake le cuesta a este ESP32
**~1.9s** (2123ms el POST completo, contra 482ms la misma conexión desde una PC — la
diferencia es criptografía por software). Un POST sobre una conexión ya abierta tarda
**~250ms** (medido entre 229 y 306ms). Como entre cambio y cambio de zona pasan minutos
u horas, sin mantener la conexión viva prácticamente *todo* reporte real pagaría el
handshake: ~2.3s de punta a punta en vez de ~0.5s. La tarea de red hace un
`GET /api/device/ping` (200 con un body minimo) cada 45s, con margen sobre los 60s
medidos. El costo en Railway es despreciable y queda en contexto: el ESP32 del portón ya
hace 86.400 requests/día con consulta SQL incluida; esto agrega 1.920 sin consulta.

**Actualización inmediata por Server-Sent Events (SSE).** Después de persistir un
reporte, el backend lo publica a las conexiones abiertas en
`GET /api/dispositivos/eventos`. La página mantiene una conexión `EventSource` y aplica
el cambio apenas llega, sin esperar polling. Una consulta cada 60s queda solamente como
recuperación ante eventos perdidos durante reconexiones o redeploys. SSE alcanza porque
este canal es unidireccional (servidor → navegador); no hace falta WebSocket.

## Alternativas consideradas

- **Streaming de flancos crudos al backend, decodificar centralizado** — descartado: más
  infraestructura (WebSocket a través de Railway, más tráfico) para redecodificar algo
  que ya sabemos decodificar a bordo. No hay ninguna ventaja, solo más piezas móviles.
- **Reanudación de sesión TLS (`WiFiClientSecure::setSession`) en vez del ping** — no
  agrega tráfico, pero solo recorta parte del handshake: dejaría el reporte en ~1.2s
  contra los ~0.25s del keep-warm. Se prefirió el ping porque el tráfico que evita es
  irrelevante a esta escala y la mejora es 5x mayor.
- **Achicar la ventana de captura para ganar latencia** — no: 200ms ya está cerca del
  mínimo teórico de 143ms que garantiza una copia completa de la trama, y aporta ~100ms
  promedio contra los ~1900ms que aporta atacar el handshake. Mal negocio.
- **Reescribir `RfReceiver` como ring buffer continuo** — más "correcto" en abstracto,
  pero cambia una clase compartida ya validada en producción (portón) para un patrón de
  uso que nunca necesitó. El ciclo de captura corta ya alcanza para esta cadencia de
  cambio de estado.
- **Tabla de historial de estados en vez de un campo en `dispositivos`** — se descartó
  por ahora: no hay necesidad de auditoría de zonas (a diferencia de `comandos`, donde sí
  importa quién activó el portón). Si aparece esa necesidad, es un cambio aislado.

## Consecuencias

- El firmware del alarm-sniffer ahora tiene un componente "siempre encendido" (WiFi +
  ciclo de captura) además de los comandos manuales por serial — primera vez que corre
  así por tiempo prolongado; vale la pena observar estabilidad (memoria, reconexión WiFi)
  en los primeros días de uso real, no se validó para operación 24/7 todavía.
- Falta correr en producción: `npm run migrate 002_estado_dispositivo.sql` y
  `npm run seed dispositivo "Alarma" alarma`, y completar `kAlarmDeviceToken` en el
  `Secrets.h` local (gitignored) con el token que imprime el seed.
- El intento de escritura (ADR-0008) queda documentado tal cual, sin revertir: el
  circuito y el driver siguen en el repo por si se retoma, pero no se usan.
