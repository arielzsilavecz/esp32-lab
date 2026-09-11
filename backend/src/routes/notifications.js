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
    `SELECT enabled FROM push_subscriptions
     WHERE endpoint = $1 AND usuario_id = $2`,
    [endpoint, req.session.userId]
  );
  res.json({ enabled: result.rows[0]?.enabled === true });
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
