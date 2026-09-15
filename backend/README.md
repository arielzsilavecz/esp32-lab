# backend/

Centro de mando de dispositivos domoticos (Node/Express + Postgres, pensado para
Railway). El porton es el primer dispositivo; el modelo de datos es generico
(`dispositivos`/`comandos`) para que sumar luces o sensores despues sea una fila nueva,
no una tabla nueva. Ver `docs/decisions/0006-backend-smart-home.md` para el porque de
cada decision de esta carpeta.

## Como funciona

- **Personas** (navegador): login con email/password (bcrypt + cookie de sesion),
  ven los dispositivos y les mandan comandos ("Activar"). Abrir el porton exige
  ademas una credencial WebAuthn del telefono o PC (huella, rostro o PIN del sistema).
- **Dispositivos** (ESP32, etc.): autenticados por un token propio
  (`Authorization: Bearer <token>`), hacen polling a `GET /api/device/comando-pendiente`
  y confirman con `POST /api/device/comando/:id/consumido`. No usan sesion/cookie.
- Un solo proceso Express sirve la API y el frontend estatico (`public/`) — no hay
  Vercel ni build step de frontend (HTML/CSS/JS plano).

## Setup local

La interfaz tambien es una PWA instalable. Cada navegador puede activar
**Estoy afuera** para recibir Web Push ante cualquier cambio de zona, incluso
con la pagina cerrada. Tambien puede programar dias y horas de aviso automatico;
el horario se interpreta en `America/Argentina/Buenos_Aires` y admite periodos
que cruzan medianoche. El limite compartido es un aviso cada 5 minutos por
navegador.

```
npm install
cp .env.example .env   # completar DATABASE_URL y SESSION_SECRET
npm run migrate         # crea las tablas
npm run seed usuario tu@email.com "tu-password" "Tu Nombre"
npm run seed dispositivo "Porton" porton   # imprime el token para el firmware
npm run dev
```

## Deploy en Railway

Railway detecta un proyecto Node por `package.json` (`npm start`) sin configuracion
adicional. Variables de entorno a cargar en el servicio: `DATABASE_URL` (la da el addon
de Postgres de Railway), `SESSION_SECRET` y `NODE_ENV=production`. Las claves VAPID
se generan una sola vez y quedan guardadas en PostgreSQL. Opcionalmente se pueden
inyectar con `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`. Correr
`npm run migrate` y `npm run seed` una vez contra la base de producción (por ejemplo
desde la consola de Railway, o localmente apuntando `DATABASE_URL` a la base remota).

Para habilitar las notificaciones tambien hay que ejecutar una vez:

```
npm run migrate -- 005_push_subscriptions.sql
npm run migrate -- 006_notification_schedules.sql
npm run migrate -- 007_webauthn_credentials.sql
```

WebAuthn toma automaticamente el dominio y origen de cada request. En produccion se
pueden fijar explicitamente con `WEBAUTHN_RP_ID` (solo hostname) y `WEBAUTHN_ORIGIN`
(URL HTTPS completa), especialmente si hay mas de un dominio apuntando al servicio.

## Limitaciones conocidas, a proposito

### Ordenes inmediatas y presencia del ESP32

Aplicar `npm run migrate -- 008_command_expiry_presence.sql` antes de desplegar
el backend nuevo. Luego cargar el firmware nuevo de `alarm-sniffer`.
El firmware exige `ttl_ms`: con un backend anterior descarta las ordenes.

Las ordenes caducan a los 5 segundos y se entregan como maximo una vez. Una
respuesta perdida puede perder una apertura, pero nunca provoca un reenvio
automatico. Las ordenes anteriores a la migracion quedan vencidas conservando
el historial. No se acepta una orden sin contacto del dispositivo en los
ultimos 10 segundos. El firmware tambien comprueba el plazo antes de transmitir.
La confirmacion significa que el ESP32 transmitio RF, no que el porton se abrio
fisicamente (no hay sensor de posicion).

El badge consulta cada 5 segundos la ultima request autenticada del dispositivo.
Porton: sin contacto por 10 segundos pasa a desconectado. Alarma: 90 segundos,
porque mantiene contacto con un ping cada 45 segundos aunque no cambien zonas.
Estos indicadores miden comunicacion con el backend, no validan el cable del bus
ni que el estado del sensor sea una lectura nueva. Si falla la conexion de la
pagina al backend se muestra un estado distinto y se deshabilita Activar.

Prueba SQL aislada (tablas temporales y rollback): `node src/commandPolicy.test.js`.

- **Sesiones en memoria** (`express-session` MemoryStore, el default): no sobreviven un
  redeploy/restart del contenedor — todos vuelven a loguearse. Aceptable para un puñado
  de usuarios de confianza. Si molesta, la salida es `connect-redis` (ya usado en
  `bot-backend`), no algo para sumar de entrada sin necesidad probada.
- **SSL permisivo hacia Postgres** (`rejectUnauthorized: false` en `src/db.js`): revisar
  si hace falta endurecerlo mas adelante.
