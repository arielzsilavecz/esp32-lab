import webpush from 'web-push';
import { pool } from './db.js';

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

export async function notifyZoneChanges(device, previousState, currentState) {
  if (device.tipo !== 'alarma') return;

  const changes = zoneChanges(previousState, currentState);
  if (changes.length === 0) return;
  await configureVapid();

  // Reclamar primero las suscripciones elegibles evita dos avisos simultaneos
  // si llegan dos reportes casi juntos. El cooldown es propio de cada
  // navegador, no de la cuenta ni de la alarma.
  const subscriptions = await pool.query(
    `WITH local_clock AS (
       SELECT endpoint,
              (now() AT TIME ZONE schedule_timezone)::time AS local_time,
              EXTRACT(ISODOW FROM now() AT TIME ZONE schedule_timezone)::int AS local_day
       FROM push_subscriptions
       WHERE enabled = true OR schedule_enabled = true
     )
     UPDATE push_subscriptions AS subscription
     SET last_notified_at = now(), updated_at = now()
     FROM local_clock AS clock
     WHERE subscription.endpoint = clock.endpoint
       AND (
         subscription.enabled = true
         OR (
           subscription.schedule_enabled = true
           AND (
             (subscription.schedule_start < subscription.schedule_end
              AND clock.local_day = ANY(subscription.schedule_days)
              AND clock.local_time >= subscription.schedule_start
              AND clock.local_time < subscription.schedule_end)
             OR
             (subscription.schedule_start > subscription.schedule_end
              AND ((clock.local_time >= subscription.schedule_start
                    AND clock.local_day = ANY(subscription.schedule_days))
                   OR (clock.local_time < subscription.schedule_end
                       AND (((clock.local_day + 5) % 7) + 1)
                           = ANY(subscription.schedule_days))))
           )
         )
       )
       AND (last_notified_at IS NULL
            OR last_notified_at <= now() - make_interval(mins => $1))
     RETURNING subscription.endpoint, subscription.subscription`,
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
      await webpush.sendNotification(subscription, payload, {
        TTL: PUSH_TTL_SECONDS,
        urgency: PUSH_URGENCY,
      });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await removeExpiredSubscription(endpoint);
        return;
      }
      console.error('No se pudo enviar una notificacion Push:', error.message);
    }
  }));
}

// Alertas de servidor: solo a quienes activaron alertas_servidor. No usa ni
// actualiza last_notified_at (cooldown de la alarma); cada alerta tiene el suyo.
export async function notifyServerAlert(title, body, tag) {
  await configureVapid();
  const { rows } = await pool.query(
    'SELECT endpoint, subscription FROM push_subscriptions WHERE alertas_servidor = true'
  );
  const payload = JSON.stringify({ title, body, tag, url: '/' });
  await Promise.all(rows.map(async ({ endpoint, subscription }) => {
    try {
      await webpush.sendNotification(subscription, payload, { TTL: PUSH_TTL_SECONDS, urgency: PUSH_URGENCY });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) return removeExpiredSubscription(endpoint);
      console.error('No se pudo enviar una alerta de servidor:', error.message);
    }
  }));
}
