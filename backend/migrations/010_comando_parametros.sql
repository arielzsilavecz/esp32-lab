-- Valores de una orden (brillo, blanco, color de una luz). Null para las
-- ordenes que no llevan valores (activar el porton, encender, apagar).
-- Aditiva: las ordenes existentes quedan con null y nada cambia para el ESP32.
ALTER TABLE comandos
  ADD COLUMN IF NOT EXISTS parametros JSONB;
