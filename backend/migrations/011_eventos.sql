-- Registro de eventos de un dispositivo en texto (hoy: la vigilancia de la
-- camara, ADR-0015). A diferencia de `estados` no es un snapshot: cada fila ya
-- es una linea del registro ("Vigilancia activada", "Foto de Z1", resultado de
-- un analisis). `captura` es el id de la foto en memoria, si la hubo (vence a
-- las 24 h; despues la linea queda sin foto).
CREATE TABLE IF NOT EXISTS eventos (
  id             SERIAL PRIMARY KEY,
  dispositivo_id INTEGER NOT NULL REFERENCES dispositivos(id),
  texto          TEXT NOT NULL,
  captura        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eventos_dispositivo
  ON eventos (dispositivo_id, created_at DESC);
