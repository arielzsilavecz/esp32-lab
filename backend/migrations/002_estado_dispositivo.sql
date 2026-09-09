-- Estado que un dispositivo reporta de si mismo (direccion opuesta a
-- `comandos`, que van de la app hacia el dispositivo). Primer caso de uso:
-- las 6 zonas del sniffer de alarma. JSONB generico a proposito, mismo
-- criterio que dispositivos.tipo -- no hay un shape fijo por tipo de
-- dispositivo todavia, y forzar uno ahora seria adivinar necesidades
-- futuras. Nullable: la mayoria de los dispositivos (ej. el porton) nunca
-- van a reportar estado.
ALTER TABLE dispositivos
  ADD COLUMN IF NOT EXISTS estado JSONB,
  ADD COLUMN IF NOT EXISTS estado_actualizado_at TIMESTAMPTZ;
