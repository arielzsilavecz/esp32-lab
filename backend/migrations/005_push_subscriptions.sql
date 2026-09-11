-- Una fila por instalacion/navegador. El endpoint Push identifica al
-- dispositivo concreto, por eso "Estoy afuera" no se comparte entre los
-- demas celulares o navegadores de la misma cuenta.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint         TEXT PRIMARY KEY,
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  subscription     JSONB NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT false,
  last_notified_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_enabled
  ON push_subscriptions (enabled)
  WHERE enabled = true;

-- Una unica identidad VAPID estable para el servidor. Se genera al recibir la
-- primera consulta y se guarda aca para que sobreviva a los redeploys.
CREATE TABLE IF NOT EXISTS push_configuration (
  singleton   BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
