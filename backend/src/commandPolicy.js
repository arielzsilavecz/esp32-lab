// Entrega como maximo una vez: si se pierde la respuesta, se pierde la orden.
// Nunca reenviar una apertura por ausencia de confirmacion.
export const claimCommandSql = `
  UPDATE comandos SET delivered_at = clock_timestamp()
  WHERE id = (
    SELECT id FROM comandos
    WHERE dispositivo_id = $1 AND consumido_at IS NULL
      AND delivered_at IS NULL AND expires_at > clock_timestamp()
    ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
  )
  RETURNING id, tipo_comando, parametros,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (expires_at - clock_timestamp())) * 1000))::int AS ttl_ms`;

// $4 = parametros (JSONB, null para ordenes sin valores como activar/encender).
// $5 = el dispositivo tiene una espera larga abierta (cuenta como presente
// aunque su ultimo contacto tenga mas de 10 s; ver esperaComandos.js).
export const createCommandSql = `
  INSERT INTO comandos (dispositivo_id, tipo_comando, created_by, expires_at, parametros)
  SELECT id, $2, $3, clock_timestamp() + interval '5 seconds', $4::jsonb
  FROM dispositivos WHERE id = $1
    AND ($5::boolean OR last_seen_at > clock_timestamp() - interval '10 seconds')
  RETURNING id, created_at, expires_at`;
