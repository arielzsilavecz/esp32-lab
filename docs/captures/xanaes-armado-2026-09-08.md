# Captura — intento de decodificar estado de armado — 2026-09-08

- **Archivo**: `xanaes-armado-2026-09-08.csv`
- **Qué se hizo**: armar con clave (4 dígitos), esperar, desarmar con la misma clave
  (el usuario reingresó el código sabiendo que ya estaba armada, no tras los 30s de
  tiempo de salida de fábrica — se confirmó que el sistema ya estaba activo antes de
  volver a apretar).

## Resultado: inconcluso — no se encontró un flag estable de armado

Se buscaron posiciones en la trama de 145 símbolos que cambiaran entre el momento antes
de armar y el momento (ya armado) antes de desarmar. Ninguna posición mostró un cambio
limpio de un valor estable a otro — **todas siguen variando de muestra a muestra**,
tanto antes como después de armar.

Eso apunta a que lo que cambia ahí no es un flag de estado sino algo que varía todo el
tiempo independientemente del armado — candidato más probable: **el reloj en tiempo
real del panel** (tiene uno, ver posiciones 180-184 del manual de programación), que
naturalmente nunca se repite.

## No bloquea nada

Controlar armado/desarmado desde la app **no depende** de decodificar este flag — con
la tabla de códigos de tecla (`docs/hardware/xanaes-dato-protocol.md`) alcanza para
transmitir la secuencia. El backend puede llevar su propio registro de qué comandó la
última vez en lugar de leer el estado real del panel — ver ADR-0008.

## Si se retoma

Habría que aislar el reloj primero (capturar varias muestras seguidas del reposo,
ver qué posiciones cambian con un patrón consistente con segundos/minutos avanzando) y
recién después buscar el armado por descarte — mezclar ambas búsquedas en una sola
captura, como se hizo acá, no permite separarlas.
