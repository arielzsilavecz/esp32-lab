-- Credenciales WebAuthn asociadas a cada usuario. Solo se guarda la clave
-- publica; la huella, rostro o PIN nunca salen del telefono/PC.
CREATE TABLE webauthn_credentials (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  credential_id          TEXT UNIQUE NOT NULL,
  public_key             BYTEA NOT NULL,
  counter                BIGINT NOT NULL DEFAULT 0,
  transports             JSONB NOT NULL DEFAULT '[]'::jsonb,
  credential_device_type TEXT,
  backed_up               BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webauthn_credentials_user
  ON webauthn_credentials (user_id);
