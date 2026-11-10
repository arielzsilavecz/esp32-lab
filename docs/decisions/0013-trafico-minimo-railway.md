# ADR-0013: Trafico y almacenamiento minimos en Railway

## Estado

Aceptado

## Fecha

2026-11-10

## Contexto

El usuario pidio que todo lo que pueda vivir en local no ocupe Railway, y que no
haya consultas innecesarias. Medicion en produccion (2026-11-10):

- Base: ~7 MB. A 60 dias sin cambios, ~45 MB: NEO ~1400 filas/dia (los graficos
  muestran como mucho 24 h), disyuntor ~1400/dia, luces con un latido cada 10 min
  que la pagina no muestra.
- Trafico: el puente de NEO preguntaba "hay orden?" cada 1 s por dispositivo
  (~300.000 consultas/dia con luces, disyuntor y camara); el disyuntor mandaba
  metricas cada 5 s aunque nadie mirara (~17.000/dia); la pagina consultaba el
  badge cada 5 s aun en segundo plano.

## Decision

- **Espera larga de ordenes** (`GET /api/device/comando-pendiente?espera=25`,
  `src/esperaComandos.js`): si no hay orden, la consulta queda abierta hasta 25 s
  y responde apenas se crea una (aviso en memoria). Una consulta cada ~25 s por
  dispositivo y la orden llega al instante. Una espera abierta cuenta como
  presencia al crear ordenes (`$5` de `createCommandSql`). Sin `espera` responde
  al instante como siempre: el ESP32 del porton no cambia.
- **El puente separa ordenes y estado**: un hilo espera ordenes; otro lee Home
  Assistant cada 1 s en local (gratis) y reporta a Railway solo si cambio algo.
  Si el backend no hace espera larga, el puente no baja de 1 consulta/s (no hay
  bucle sin pausa).
- **Metricas en vivo del disyuntor solo con alguien mirando**: el backend informa
  `X-Pagina-Abierta` (hay suscriptores SSE) y despierta las esperas al abrirse
  una pagina. Con pagina: cada 5 s; sin pagina: cada 60 s (el historial por minuto
  no cambia: politica de 55 s).
- **La pagina no consulta nada oculta** y cierra el canal SSE al ocultarse (asi el
  backend sabe que nadie mira); al volver lo reabre y relee los estados.
- **Historial**: luces y camara solo cambios (sin latidos); NEO 2 dias; disyuntor
  con detalle por minuto 7 dias y despues por hora la ultima lectura, la de mayor
  potencia y la primera de cada dia. Verificado en produccion (en una transaccion
  deshecha): totales del mes y potencia maxima identicos tras compactar 1020 filas.

## Alternativas consideradas

- **Bajar la frecuencia de consulta** (cada 3-5 s): menos consultas pero ordenes
  mas lentas. La espera larga mejora las dos cosas.
- **WebSocket permanente desde NEO**: equivalente a la espera larga, mas codigo en
  backend y puente para el mismo resultado.
- **Guardar el historial de NEO solo en NEO** (ya hay CSV local): los graficos de la
  pagina se sirven desde Railway; 2 dias en la base es el minimo que los alimenta.

## Consecuencias

- Del orden de 300.000 a ~15.000 consultas/dia del puente; ordenes mas rapidas.
- Pendiente: el ESP32 del porton sigue consultando cada 1 s (~86.000/dia). Pasarlo
  a espera larga requiere cambiar el firmware (timeout del cliente HTTP > 25 s).
- Los graficos de dias del disyuntor de mas de 7 dias se ven por hora, no por minuto.
