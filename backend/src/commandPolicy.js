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
  RETURNING id, tipo_comando,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (expires_at - clock_timestamp())) * 1000))::int AS ttl_ms`;

export const createCommandSql = `
  INSERT INTO comandos (dispositivo_id, tipo_comando, created_by, expires_at)
  SELECT id, $2, $3, clock_timestamp() + interval '5 seconds'
  FROM dispositivos WHERE id = $1
    AND last_seen_at > clock_timestamp() - interval '10 seconds'
  RETURNING id, created_at, expires_at`;
