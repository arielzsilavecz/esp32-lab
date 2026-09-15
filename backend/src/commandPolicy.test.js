import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from './db.js';
import { claimCommandSql, createCommandSql } from './commandPolicy.js';

test('ordenes vencidas, offline y entrega unica (tablas temporales, rollback)', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE dispositivos (
      id int PRIMARY KEY, last_seen_at timestamptz) ON COMMIT DROP`);
    await client.query(`CREATE TEMP TABLE comandos (
      id serial PRIMARY KEY, dispositivo_id int, tipo_comando text, created_by int,
      created_at timestamptz DEFAULT clock_timestamp(), expires_at timestamptz,
      delivered_at timestamptz, consumido_at timestamptz) ON COMMIT DROP`);
    await client.query(`INSERT INTO dispositivos VALUES (1, NULL), (2, clock_timestamp())`);
    assert.equal((await client.query(createCommandSql, [1, 'activar', 1])).rowCount, 0);
    const fresh = await client.query(createCommandSql, [2, 'activar', 1]);
    assert.equal(fresh.rowCount, 1);
    await client.query(`INSERT INTO comandos (dispositivo_id, tipo_comando, expires_at)
      VALUES (2, 'activar', clock_timestamp() - interval '8 hours')`);
    const claimed = await client.query(claimCommandSql, [2]);
    assert.equal(claimed.rows[0].id, fresh.rows[0].id);
    assert.ok(claimed.rows[0].ttl_ms > 0 && claimed.rows[0].ttl_ms <= 5000);
    // ACK perdido, nuevo polling/reconexion: no vuelve a entregar ninguna orden.
    assert.equal((await client.query(claimCommandSql, [2])).rowCount, 0);
    await client.query(`UPDATE dispositivos SET last_seen_at = clock_timestamp() - interval '11 seconds' WHERE id=2`);
    assert.equal((await client.query(createCommandSql, [2, 'activar', 1])).rowCount, 0);
    console.log('Offline, expiracion y no repeticion: OK');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
