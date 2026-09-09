# ADR-0008: Transmisor de DATO — topología eléctrica y diseño open-drain

## Estado

Aceptado (decisión de diseño). **No implementado todavía** — este ADR fija el enfoque
antes de escribir el driver, seguido después.

## Fecha

2026-09-08

## Contexto

Con las 12 teclas y el estado de zonas 1-6 decodificados (ver
`docs/hardware/xanaes-dato-protocol.md`), el siguiente paso natural es poder
**escribir** en DATO — simular una pulsación real, para armar/desarmar el panel desde
la app en vez de solo escuchar.

A diferencia del transmisor RF del portón (ADR-0005), acá el medio no es aire: DATO es
un **cable compartido** donde el teclado real y el panel ya se están comunicando.
Conectar una salida propia sin saber cómo maneja el bus sus niveles eléctricos podía
significar dos drivers empujando la línea en direcciones opuestas al mismo tiempo —
riesgo real de daño en la etapa de salida de un dispositivo real, no un experimento de
laboratorio descartable.

## Decisión

**Se determinó la topología eléctrica del bus sin desconectar la alimentación del
panel**, con una medición puramente pasiva: con DATO en reposo (~11.4V) se conectó una
resistencia de prueba de 10kΩ entre DATO y GND, y se volvió a medir (9.1V). Resolviendo
el circuito como divisor, esto da un **pull-up interno de ~2.7kΩ hacia el riel de
+12V** (el modelo predice 11.39V y 9.08V con esos valores — coincide con lo medido casi
exacto).

Esto confirma **colector abierto**, no push-pull: ningún dispositivo en el bus empuja
activamente el nivel alto, todos solo tiran hacia GND cuando quieren transmitir un "0",
y la resistencia de pull-up sostiene el nivel alto cuando nadie tira.

**El transmisor se diseña en consecuencia, como colector/drenador abierto**: un GPIO
del ESP32 controla un transistor (NPN o MOSFET N) cuyo colector/drenador se conecta a
DATO y emisor/fuente a GND. El GPIO en alto prende el transistor y **tira** DATO a GND
(bit "0"); el GPIO en bajo apaga el transistor y **suelta** la línea, dejando que el
pull-up del bus la lleve a alto sola (bit "1"). El ESP32 **nunca empuja tensión hacia
la línea** — solo tira hacia abajo o suelta, igual que cualquier otro dispositivo real
del bus. Esto hace que un conflicto eléctrico con el teclado real sea imposible por
construcción, no por cuidado de software.

La generación de la secuencia de bits (timing) sigue siendo enteramente responsabilidad
del firmware — mismo patrón que `RfTransmitter` (ADR-0005): el transistor es la
traducción eléctrica necesaria para este bus en particular, no un cambio en dónde vive
la lógica.

## Alternativas consideradas

- **Apagar el panel y medir con multímetro en modo resistencia** — más directo, pero el
  usuario prefirió no desconectar un sistema de seguridad en uso. La medición con carga
  resistiva en vivo da la misma información sin ese costo.
- **Conectar el GPIO directo a DATO (push-pull)** — descartada: expondría al conflicto
  eléctrico exacto que se buscaba evitar si la topología hubiera resultado push-pull, y
  aun confirmado colector abierto, seguiría siendo una salida que empuja activamente el
  nivel alto en vez de sólo tirar hacia abajo — no respeta la convención del bus aunque
  "funcione" en la práctica.

## Consecuencias

- Queda pendiente elegir el transistor concreto y armar el circuito (no bloqueante,
  cualquier NPN de señal chico o MOSFET N de bajo umbral sirve dado que la corriente en
  juego es mínima).
- Controlar el panel desde la app **no requiere** decodificar el estado de armado real
  (ver intento en `docs/captures/xanaes-armado-2026-09-08.md`, sin éxito — parece
  mezclado con el reloj en tiempo real del panel). El backend puede llevar su propio
  registro de "qué comandé la última vez" como aproximación al estado, con la
  limitación conocida de que se desincroniza si alguien usa el teclado físico en
  paralelo.
- Si en algún momento se decodifica el estado de armado real, sería un cambio aislado
  (agregar lectura de esa posición), sin tocar el diseño del transmisor.
