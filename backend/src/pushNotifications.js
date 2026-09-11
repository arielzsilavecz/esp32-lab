import webpush from 'web-push';
import { pool } from './db.js';

const NOTIFICATION_COOLDOWN_MINUTES = 5;
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

export async function notifyZoneChanges(device, previousState, currentState) {
  if (device.tipo !== 'alarma') return;

  const changes = zoneChanges(previousState, currentState);
  if (changes.length === 0) return;
  await configureVapid();

  // Reclamar primero las suscripciones elegibles evita dos avisos simultaneos
  // si llegan dos reportes casi juntos. El cooldown es propio de cada
  // navegador, no de la cuenta ni de la alarma.
  const subscriptions = await pool.query(
    `UPDATE push_subscriptions
     SET last_notified_at = now(), updated_at = now()
     WHERE enabled = true
       AND (last_notified_at IS NULL
            OR last_notified_at <= now() - make_interval(mins => $1))
     RETURNING endpoint, subscription`,
    [NOTIFICATION_COOLDOWN_MINUTES]
  );

  const payload = JSON.stringify({
    title: device.nombre,
    body: notificationBody(changes),
    tag: 'alarma-cambio-zona',
    url: '/',
  });

  await Promise.all(subscriptions.rows.map(async ({ endpoint, subscription }) => {
    try {
      await webpush.sendNotification(subscription, payload);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await removeExpiredSubscription(endpoint);
        return;
      }
      console.error('No se pudo enviar una notificacion Push:', error.message);
    }
  }));
}
