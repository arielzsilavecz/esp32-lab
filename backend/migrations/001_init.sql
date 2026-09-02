-- Esquema inicial. Ver docs/decisions/0006-backend-smart-home.md para el porque
-- del modelo generico dispositivos/comandos (el porton es el primer dispositivo,
-- no un caso especial).

CREATE TABLE usuarios (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nombre        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dispositivos (
  id         SERIAL PRIMARY KEY,
  nombre     TEXT NOT NULL,
  tipo       TEXT NOT NULL,        -- 'porton', 'luz', 'sensor', etc. Texto libre a proposito:
                                    -- no hay un catalogo cerrado de tipos todavia.
  token      TEXT UNIQUE NOT NULL, -- credencial que usa el dispositivo (no una persona) para autenticarse
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE comandos (
  id             SERIAL PRIMARY KEY,
  dispositivo_id INTEGER NOT NULL REFERENCES dispositivos(id),
  tipo_comando   TEXT NOT NULL,    -- 'activar', etc. Texto libre por el mismo motivo que dispositivos.tipo.
  created_by     INTEGER NOT NULL REFERENCES usuarios(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumido_at   TIMESTAMPTZ       -- null = pendiente. La ESP32 lo llena al procesarlo.
);

-- La ESP32 hace "dame el pendiente mas viejo de este dispositivo" cada 1s:
-- indice parcial pensado exactamente para esa consulta.
CREATE INDEX idx_comandos_pendientes
  ON comandos (dispositivo_id, created_at)
  WHERE consumido_at IS NULL;
