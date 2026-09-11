import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { pool } from '../db.js';
import { getVapidPublicKey } from '../pushNotifications.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get('/public-key', async (_req, res) => {
  const publicKey = await getVapidPublicKey();
  res.json({ publicKey });
});

notificationsRouter.post('/estado', async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    return res.status(400).json({ error: 'Falta endpoint' });
  }

  const result = await pool.query(
    `SELECT enabled, schedule_enabled, schedule_days,
            to_char(schedule_start, 'HH24:MI') AS schedule_start,
            to_char(schedule_end, 'HH24:MI') AS schedule_end
     FROM push_subscriptions
     WHERE endpoint = $1 AND usuario_id = $2`,
    [endpoint, req.session.userId]
  );
  const saved = result.rows[0];
  res.json({
    enabled: saved?.enabled === true,
    schedule: {
      enabled: saved?.schedule_enabled === true,
      days: saved?.schedule_days || [1, 2, 3, 4, 5],
      start: saved?.schedule_start || '00:00',
      end: saved?.schedule_end || '08:00',
    },
  });
});

notificationsRouter.put('/suscripcion', async (req, res) => {
  const { subscription, enabled } = req.body || {};
  const valid = subscription
    && typeof subscription.endpoint === 'string'
    && typeof subscription.keys?.p256dh === 'string'
    && typeof subscription.keys?.auth === 'string'
    && typeof enabled === 'boolean';

  if (!valid) {
    return res.status(400).json({ error: 'Suscripcion invalida' });
  }

  await pool.query(
    `INSERT INTO push_subscriptions
       (endpoint, usuario_id, subscription, enabled, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (endpoint) DO UPDATE SET
       usuario_id = EXCLUDED.usuario_id,
       subscription = EXCLUDED.subscription,
       enabled = EXCLUDED.enabled,
       updated_at = now()`,
    [subscription.endpoint, req.session.userId, subscription, enabled]
  );

  res.json({ enabled });
});

notificationsRouter.put('/programacion', async (req, res) => {
  const { subscription, enabled, days, start, end } = req.body || {};
  const validSubscription = subscription
    && typeof subscription.endpoint === 'string'
    && typeof subscription.keys?.p256dh === 'string'
    && typeof subscription.keys?.auth === 'string';
  const validTime = (value) => typeof value === 'string'
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const normalizedDays = Array.isArray(days)
    ? [...new Set(days)].sort((a, b) => a - b)
    : [];
  const validDays = normalizedDays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7);

  if (!validSubscription || typeof enabled !== 'boolean' || !validDays
      || !validTime(start) || !validTime(end)
      || (enabled && (normalizedDays.length === 0 || start === end))) {
    return res.status(400).json({ error: 'Programacion invalida' });
  }

  await pool.query(
    `INSERT INTO push_subscriptions
       (endpoint, usuario_id, subscription, schedule_enabled, schedule_days,
        schedule_start, schedule_end, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (endpoint) DO UPDATE SET
       usuario_id = EXCLUDED.usuario_id,
       subscription = EXCLUDED.subscription,
       schedule_enabled = EXCLUDED.schedule_enabled,
       schedule_days = EXCLUDED.schedule_days,
       schedule_start = EXCLUDED.schedule_start,
       schedule_end = EXCLUDED.schedule_end,
       updated_at = now()`,
    [subscription.endpoint, req.session.userId, subscription, enabled,
      normalizedDays, start, end]
  );

  res.json({ enabled, days: normalizedDays, start, end });
});
