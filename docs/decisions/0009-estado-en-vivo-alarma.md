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
