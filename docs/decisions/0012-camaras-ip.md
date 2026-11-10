# ADR-0012: Grabacion continua de camaras IP en el HDD de NEO

## Estado

Aceptado

## Fecha

2026-11-10

## Contexto

Hay dos camaras IP motorizadas EYEPLUS (app YCC365 Plus) en la LAN. Se encontraron
por ONVIF (WS-Discovery) desde NEO:

- `192.168.100.122` (firmware 57.0): ONVIF sin credenciales y RTSP en 554.
  Principal `rtsp://192.168.100.122:554/0/av0` (H.265, 1920x1080, 12 fps, ~1 Mbps,
  audio G.711) y secundario `/0/av1` (640x360).
- `192.168.100.80` (firmware 16.3): ONVIF responde perfiles pero `GetStreamUri` vuelve
  vacio y el 554 esta cerrado. Solo transmite por la nube de YCC365: no se puede
  grabar localmente sin otro firmware.

El usuario quiere grabacion continua con un tope de 50 GB por camara, para repartir
el HDD de 500 GB entre varias.

## Decision

- **ffmpeg en el host, `-c copy`**: guarda el H.265 tal cual, sin recodificar
  (~2 % de un nucleo medido). Recodificar a H.264 no entra en el A6 limitado a 1,9 GHz.
- **Una instancia systemd por camara** (`camara@<nombre>.service`) con su config en
  `/etc/neo-camaras/<nombre>.env` (`CAM_URL`, `CAM_LIMITE_GB`). Sumar una camara es
  agregar un `.env` y habilitar la instancia. Reintento automatico cada 10 s.
- **Segmentos de 10 min en Matroska** en `/mnt/backups/camaras/<nombre>/`: un corte de
  luz pierde a lo sumo el ultimo tramo, y Matroska admite el audio G.711.
- **Limite por camara** con `camaras-limpiar.sh` (timer cada 10 min): borra lo mas
  viejo de cada camara hasta quedar bajo su limite; nunca el segmento en escritura.
- **Usuario de sistema `camaras`**, sin login: ffmpeg procesa datos que llegan de un
  equipo de la red y no tiene por que correr como root. `/mnt/backups` paso a 711
  (atravesable, no listable); los backups siguen siendo root 600.

## Alternativas consideradas

- **Frigate**: grabacion + deteccion por IA. Descartado: la deteccion en CPU no entra en
  el A6, y sin deteccion es una capa pesada para lo que hace ffmpeg solo.
- **Grabar solo con movimiento**: depende de eventos ONVIF de estas camaras, no
  verificados. Se eligio continua por simple y confiable.
- **`-use_wallclock_as_timestamps`**: probado y descartado. En 30 s dio 211 marcas de
  tiempo desordenadas contra 12 sin el; las marcas de la camara alcanzan.

## Consecuencias

- ~10,5 GB/dia por camara a ~1 Mbps: el tope de 50 GB da ~4-5 dias de historial.
- Las camaras no piden credenciales: cualquier equipo de la LAN ve el video. Conviene
  aislarlas de Internet mas adelante.
- H.265 no se reproduce en todos los navegadores; para ver grabaciones, VLC.

## Vista en vivo en el tablero de Railway, solo a pedido (2026-11-10)

El usuario no quiere Home Assistant para esto: la camara va en la misma pagina que
el porton y las luces, y sin gastar en Railway mientras nadie mira.

- **Nada corre sin pedido.** La tarjeta muestra solo "Ver en vivo". Al tocarlo la
  pagina manda la orden `ver` (tipo de dispositivo `camara`); el puente de NEO
  (que consulta cada 2 s) lanza ffmpeg sobre el **stream secundario** (640x360) y
  sube **2 JPEG/s** a `POST /api/device/imagen` durante **2 min**. "Seguir mirando"
  renueva los 2 min; "Detener", ocultar la pagina o el vencimiento lo cortan.
- **El backend guarda solo el ultimo cuadro en memoria** (`src/camaraCuadros.js`):
  nada en la base ni en disco; vence a los 15 s. La pagina pide
  `GET /api/dispositivos/:id/imagen?despues=<ms>` cada 0,5 s (204 si no hay uno nuevo).
- **Costo medido**: ~42 KB por cuadro, ~5 MB por minuto mirado. Sin mirar: cero
  imagenes; solo la consulta de ordenes cada 2 s, que no mueve el costo (ADR-0006).
- **Descartado por ahora**: WebRTC (H.265 no se reproduce en todos los navegadores,
  transcodificar no entra en el CPU y la conexion directa puede no atravesar el
  router) y pasar el video entero por Railway (trafico y costo).
- Sin verificacion biometrica para ver: no abre ni corta nada (decision del usuario).
- **En reposo la tarjeta es una linea** ("Ver en vivo"); el recuadro se despliega
  solo al mirar y se pliega al detener.
- **Giro (PTZ)**: orden `mover` con `{direccion}` de una lista cerrada (backend
  `validarMovimiento`, puente `GIROS`). El puente manda un pulso ONVIF
  `ContinuousMove` de 0,4 s a velocidad 0,5 y siempre `Stop` (sin credenciales en
  esta camara; `GetNodes` no esta implementado, pero el movimiento si: verificado
  con fotos antes/despues). Medido: 1 s a 0,6 corre ~1/3 del cuadro. Mientras se
  mira, el puente consulta ordenes cada 0,5 s (en reposo, cada 2 s).
- Pendiente: ver grabaciones desde la pagina.
