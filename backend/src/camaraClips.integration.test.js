import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { pool } from './db.js';
import { dispositivosRouter } from './routes/dispositivos.js';
import { deviceRouter } from './routes/device.js';

test('un registro solicita video y solo la cámara correcta puede subirlo', async () => {
  const original = pool.query;
  let parametros;
  pool.query = async (sql, valores) => {
    if (sql.includes('SELECT e.created_at')) return { rowCount: 1, rows: [{ created_at: new Date('2026-11-13T23:00:00Z') }] };
    if (sql.includes('INSERT INTO comandos')) {
      parametros = JSON.parse(valores[3]);
      return { rowCount: 1, rows: [{ id: 1 }] };
    }
    if (sql.includes('WHERE token = $1')) {
      const id = valores[0] === 'camera' ? 7 : 8;
      return { rowCount: 1, rows: [{ id, tipo: 'camara' }] };
    }
    if (sql.includes('UPDATE dispositivos SET last_seen_at')) return { rowCount: 1, rows: [] };
    throw new Error('Consulta inesperada');
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: 1 }; next(); });
  app.use('/api/dispositivos', dispositivosRouter);
  app.use('/api/device', deviceRouter);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const creacion = await fetch(`${base}/api/dispositivos/7/eventos/1/clip`, { method: 'POST' });
    assert.equal(creacion.status, 202);
    const { id } = await creacion.json();
    assert.equal(parametros.clip_id, id);
    assert.equal((await fetch(`${base}/api/dispositivos/7/clips/${id}`)).status, 204);
    const video = Buffer.from('0000ftyp0000');
    const upload = (token) => fetch(`${base}/api/device/clip/${id}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4' }, body: video,
    });
    assert.equal((await upload('otro')).status, 404);
    assert.equal((await upload('camera')).status, 204);
    const lectura = await fetch(`${base}/api/dispositivos/7/clips/${id}`);
    assert.equal(lectura.status, 200);
    assert.deepEqual(Buffer.from(await lectura.arrayBuffer()), video);
    assert.equal((await fetch(`${base}/api/dispositivos/8/clips/${id}`)).status, 404);
  } finally {
    pool.query = original;
    await new Promise((resolve) => server.close(resolve));
  }
});
