BEGIN;
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE comandos ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE comandos ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
-- Las ordenes anteriores a esta proteccion nunca deben ejecutarse al reconectar.
UPDATE comandos SET expires_at = created_at WHERE expires_at IS NULL;
ALTER TABLE comandos ALTER COLUMN expires_at SET DEFAULT (now() + interval '5 seconds');
ALTER TABLE comandos ALTER COLUMN expires_at SET NOT NULL;
COMMIT;
