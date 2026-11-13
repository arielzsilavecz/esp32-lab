# ADR-0015: Vigilancia de la camara con "Estoy afuera" y foto en los avisos de Z1/Z2

## Estado

Aceptado

## Fecha

2026-11-11

## Contexto

El usuario quiere que, estando afuera, la camara de la entrada vigile sola y
avise solo ante algo relevante (movimiento grande y sostenido con persona o
vehiculo), que se refuerce si se activan los sensores del frente (Z1 laser, Z2)
y que el aviso de Z1/Z2 traiga la foto de ese instante. Todo el analisis en NEO
(ADR-0014); Railway solo para las notificaciones.

"Estoy afuera" (manual o por horario) y las zonas viven en Railway: NEO no los
conoce.

## Decision

- **Senal sin consultas nuevas.** La espera de ordenes de cada camara (25 s,
  ADR-0013) responde con `X-Vigilancia: 1|0` (algun navegador en "Estoy afuera"
  ahora). Al cambiar el interruptor o el horario de un navegador se despiertan
  las esperas. La condicion SQL es una sola (`suscripcionActiva` en
  `src/vigilancia.js`), compartida con los avisos de zona.
- **Z1/Z2.** Al activarse, el backend marca a las camaras y despierta su espera:
  la respuesta trae `X-Reforzar: <zona>@<ms de la activacion>`. NEO guarda en
  memoria los ultimos ~12 s de fotos (2/s) y sube la de **2 s antes de Z1 / 3 s
  antes de Z2** (pedido del usuario: ver quien llego, no la reja ya cortada),
  corregida por el atraso del stream (`retraso_camara_s`, a calibrar). Usa
  `POST /api/device/captura` con `X-Motivo: zona`, la analiza sin esperar
  movimiento y por 10 min baja los umbrales. El aviso de zona espera la foto hasta 4 s; si no
  llega sale sin ella. Se pide aunque el aviso no salga por el cooldown.
- **Deteccion en NEO** (`tools/neo-bridge/vigilancia.py`), solo con vigilancia:
  un ffmpeg sobre la calidad secundaria (~7 % de un nucleo medido) da 2 cuadros/s
  de 64x36 en gris y la ultima foto en color en `/dev/shm`. Movimiento = pixeles
  distintos de un fondo que se adapta lento, sostenido (normal: 8 % de la imagen
  4 s de 6; reforzado: 3 % 1 s). Un cambio de mas del 60 % de golpe (modo noche)
  rearma el fondo. Umbrales en la config de la camara (`"vigilancia": {...}`).
- **Analisis**: el modelo 2B con vision mira la foto del disparo y responde por
  esquema JSON `{persona, vehiculo, descripcion}` (~2 min). Decide primero y
  describe solo a las personas y vehiculos: enumerarle la escena fija (jardin,
  poste, reja) para que no la describa no sirvio, el modelo la copiaba. Si hay persona o
  vehiculo, sube la foto con `X-Motivo: deteccion` y el backend avisa a quienes
  estan en "Estoy afuera". Limites: un analisis cada 3 min (1 en reforzado,
  contados desde que termina el anterior), un
  aviso cada 5 min, nada por encima de 80 °C; disparos durante la pausa se
  descartan.
- **Vehiculo = detenido frente a la entrada.** Los autos que pasan por la calle
  no interesan. Una foto no dice si algo se mueve: el prompt pide solo
  vehiculos detenidos, y si el modelo dice "vehiculo" (sin persona) se analiza
  la foto de ese momento (~2 min despues). Avisa solo si sigue ahi.
- **Registro en el tablero** (tabla `eventos`, migracion 011): vigilancia
  activada/desactivada, fotos de zona, resultado de cada analisis y avisos.
  NEO lo manda (`POST /api/device/evento`; las capturas se registran solas) y
  la tarjeta de la camara lo muestra por dia y por hora, con la foto mientras
  siga en memoria. Se borra a los 60 dias, como el resto del historial.
- **Foto en la notificacion.** El telefono baja la imagen sin cookies, asi que
  `GET /capturas/<id>.jpg` es publico: id aleatorio de 128 bits, en memoria,
  vence a las 6 h (tope 200 fotos). Android la muestra expandida; iOS no muestra
  imagenes en notificaciones web.

## Alternativas consideradas

- **NEO consultando "Estoy afuera" por su cuenta**: una consulta mas cada N
  segundos; la cabecera viaja en la consulta que ya existe.
- **Foto solo al tocar el aviso (con sesion)**: mas cerrado, pero un paso mas
  cada vez. El usuario eligio verla en la notificacion.
- **Analizar todo el video con el modelo**: imposible en este CPU (~2 min por
  imagen); el detector barato decide cuando vale la pena.
- **Un segundo aviso con la foto despues del de zona**: dos notificaciones por
  evento. Esperar hasta 4 s es imperceptible y el aviso de zona nunca se pierde.

## Consecuencias

- Railway: una consulta SQL liviana por camara cada ~25 s, y fotos solo ante
  Z1/Z2 o deteccion. Las fotos se pierden al redeployar (son de 6 h).
- NEO: modelo con vision cargado (~3,3 GB); CPU al 100 % ~2 min por analisis.
  Mientras analiza, una orden escrita del asistente espera su turno.
- Medicion real: 60 s de vigilancia sin disparos falsos (maximo 4,4 % de imagen
  cambiada); foto de Z1 subida al instante; analisis correcto en 129 s.
- Pendiente de calibrar con uso real: umbrales de dia/noche y viento.
