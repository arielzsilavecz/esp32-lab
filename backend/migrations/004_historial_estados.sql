-- Historial de estados reportados por los dispositivos. Revierte la decision
-- original de ADR-0009 de guardar solo el ultimo valor en dispositivos.estado:
-- hace falta guardar cada reporte para poder mostrar el log de activaciones
-- por hora en la pagina.
--
-- Cada fila es un snapshot completo de lo que el dispositivo reporto, no un
-- evento por zona: se mantiene el mismo criterio generico que
-- dispositivos.estado (JSONB sin shape fijo, ver ADR-0006), asi esta tabla no
-- sabe nada de zonas ni de alarmas. Las transiciones ("zona 3 se activo") se
-- derivan comparando snapshots consecutivos del lado de la pagina.
--
-- dispositivos.estado se mantiene igual: es el valor actual, y evita tener que
-- pedir el ultimo snapshot en cada carga.
CREATE TABLE IF NOT EXISTS estados (
  id             SERIAL PRIMARY KEY,
  dispositivo_id INTEGER NOT NULL REFERENCES dispositivos(id),
  estado         JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La unica consulta que se hace es "ultimos N de este dispositivo".
CREATE INDEX IF NOT EXISTS idx_estados_dispositivo
  ON estados (dispositivo_id, created_at DESC);
