-- Opt-in propio para alertas de servidor (NEO). Separado de `enabled` y de
-- `last_notified_at` a proposito: esos son de la alarma, y compartirlos haria
-- que una alerta de temperatura silencie un aviso real de zona.
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS alertas_servidor BOOLEAN NOT NULL DEFAULT false;
