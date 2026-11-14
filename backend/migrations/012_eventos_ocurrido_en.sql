-- La hora de captura precede al resultado del análisis y localiza el video.
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS ocurrido_en TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_eventos_dispositivo_ocurrido
  ON eventos (dispositivo_id, (COALESCE(ocurrido_en, created_at)) DESC);
