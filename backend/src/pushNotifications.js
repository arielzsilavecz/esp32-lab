import webpush from 'web-push';
import { pool } from './db.js';
import { pedirCaptura, suscripcionActiva } from './vigilancia.js';

const NOTIFICATION_COOLDOWN_MINUTES = 5;
const PUSH_TTL_SECONDS = 60;
const PUSH_URGENCY = 'high';
let vapidConfigured = false;
let vapidConfigurationPromise = null;
let vapidConfiguration = null;

async function loadVapidConfiguration() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
  }

  const existing = await pool.query(
    'SELECT public_key, private_key FROM push_configuration WHERE singleton = true'
  );
  if (existing.rowCount > 0) {
    return {
      publicKey: existing.rows[0].public_key,
      privateKey: existing.rows[0].private_key,
    };
  }

  const generated = webpush.generateVAPIDKeys();
  await pool.query(
    `INSERT INTO push_configuration (singleton, public_key, private_key)
     VALUES (true, $1, $2)
     ON CONFLICT (singleton) DO NOTHING`,
    [generated.publicKey, generated.privateKey]
  );

  const saved = await pool.query(
    'SELECT public_key, private_key FROM push_configuration WHERE singleton = true'
  );
  return {
    publicKey: saved.rows[0].public_key,
    privateKey: saved.rows[0].private_key,
  };
}

async function configureVapid() {
  if (vapidConfigured) return vapidConfiguration;
  vapidConfigurationPromise ||= loadVapidConfiguration();
  const configuration = await vapidConfigurationPromise;

  const subject = process.env.VAPID_SUBJECT
    || (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'mailto:admin@example.com');

  webpush.setVapidDetails(subject, configuration.publicKey, configuration.privateKey);
  vapidConfiguration = configuration;
  vapidConfigured = true;
  return configuration;
}

export async function getVapidPublicKey() {
  return (await configureVapid()).publicKey;
}

function zoneChanges(previousState, currentState) {
  const previous = previousState?.zonas;
  const current = currentState?.zonas;
  if (!Array.isArray(previous) || !Array.isArray(current)) return [];

  return current.flatMap((active, index) =>
    active !== previous[index] ? [{ zone: index + 1, active: active === true }] : []
  );
}

function notificationBody(changes) {
  if (changes.length === 1) {
    const change = changes[0];
    return `Zona ${change.zone} ${change.active ? 'activada' : 'en reposo'}`;
  }

  return `Cambios: ${changes.map((change) =>
    `Z${change.zone} ${change.active ? 'activada' : 'en reposo'}`).join(', ')}`;
}

async function removeExpiredSubscription(endpoint) {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

async function enviar(rows, aviso) {
  const payload = JSON.stringify(aviso);
  await Promise.all(rows.map(async ({ endpoint, subscription }) => {
    try {
      await webpush.sendNotification(subscription, payload, { TTL: PUSH_TTL_SECONDS, urgency: PUSH_URGENCY });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) return removeExpiredSubscription(endpoint);
      console.error('No se pudo enviar una notificacion Push:', error.message);
    }
  }));
}

// Z1 (laser) y Z2: el frente, que ve la camara de la entrada.
const ZONAS_FRENTE = [1, 2];
const ESPERA_CAPTURA_MS = 4000;

export async function notifyZoneChanges(device, previousState, currentState) {
  if (device.tipo !== 'alarma') return;

  const changes = zoneChanges(previousState, currentState);
  if (changes.length === 0) return;

  // Se pide antes de todo: NEO saca la foto del instante (y pasa a vigilancia
  // reforzada) aunque este aviso no salga por el cooldown. Si no hay nadie en
  // "Estoy afuera", NEO no esta vigilando y lo ignora.
  // La hora es la de llegada del reporte: NEO busca la foto de 2-3 s antes.
  const frente = changes.find((c) => c.active && ZONAS_FRENTE.includes(c.zone));
  // .catch: si no hay a quien avisar no se espera, y un rechazo suelto tumbaria el proceso.
  const captura = frente ? pedirCaptura(ESPERA_CAPTURA_MS, frente.zone, Date.now()).catch(() => null) : null;
  await configureVapid();

  // Reclamar primero las suscripciones elegibles evita dos avisos simultaneos
  // si llegan dos reportes casi juntos. El cooldown es propio de cada
  // navegador, no de la cuenta ni de la alarma.
  const subscriptions = await pool.query(
    `UPDATE push_subscriptions AS s
     SET last_notified_at = now(), updated_at = now()
     WHERE ${suscripcionActiva('s')}
       AND (s.last_notified_at IS NULL
            OR s.last_notified_at <= now() - make_interval(mins => $1))
     RETURNING s.endpoint, s.subscription`,
    [NOTIFICATION_COOLDOWN_MINUTES]
  );
  if (subscriptions.rowCount === 0) return;

  // Hasta 4 s por la foto; si NEO no llega, el aviso sale igual sin ella.
  const capturaId = await captura;
  await enviar(subscriptions.rows, {
    title: device.nombre,
    body: notificationBody(changes),
    tag: 'alarma-cambio-zona',
    url: '/',
    ...(capturaId && { image: `/capturas/${capturaId}.jpg` }),
  });
}

// Deteccion de la camara (persona o vehiculo, analizado en NEO). A quienes
// estan en "Estoy afuera"; el limite de frecuencia lo pone NEO.
export async function notifyCameraAlert(device, descripcion, capturaId) {
  await configureVapid();
  const { rows } = await pool.query(
    `SELECT s.endpoint, s.subscription FROM push_subscriptions s WHERE ${suscripcionActiva('s')}`);
  await enviar(rows, {
    title: device.nombre,
    body: descripcion,
    tag: 'camara-deteccion',
    url: '/',
    image: `/capturas/${capturaId}.jpg`,
  });
}

// Alertas de servidor: solo a quienes activaron alertas_servidor. No usa ni
// actualiza last_notified_at (cooldown de la alarma); cada alerta tiene el suyo.
export async function notifyServerAlert(title, body, tag) {
  await configureVapid();
  const { rows } = await pool.query(
    'SELECT endpoint, subscription FROM push_subscriptions WHERE alertas_servidor = true'
  );
  await enviar(rows, { title, body, tag, url: '/' });
}
