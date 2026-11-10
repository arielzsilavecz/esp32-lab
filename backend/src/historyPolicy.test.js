import test from 'node:test';
import assert from 'node:assert/strict';
import { debePersistir } from './historyPolicy.js';

test('disyuntor: guarda cambio de encendido o 1 vez por minuto, no cada 5 s', () => {
  const t0 = 1_000_000;
  assert.equal(debePersistir('disyuntor', 1, { encendido: true, potencia_w: 10 }, t0), true);
  assert.equal(debePersistir('disyuntor', 1, { encendido: true, potencia_w: 12 }, t0 + 5_000), false);
  assert.equal(debePersistir('disyuntor', 1, { encendido: true, potencia_w: 11 }, t0 + 30_000), false);
  assert.equal(debePersistir('disyuntor', 1, { encendido: false, potencia_w: 0 }, t0 + 31_000), true);
  assert.equal(debePersistir('disyuntor', 1, { encendido: false, potencia_w: 0 }, t0 + 92_000), true);
});

test('luz: guarda cambios, y un latido cada 10 min', () => {
  const t0 = 2_000_000;
  assert.equal(debePersistir('luz', 2, { encendido: true }, t0), true);
  assert.equal(debePersistir('luz', 2, { encendido: true }, t0 + 30_000), false);
  assert.equal(debePersistir('luz', 2, { encendido: false }, t0 + 40_000), true);
  assert.equal(debePersistir('luz', 2, { encendido: false }, t0 + 40_000 + 600_000), true);
});

test('tipos sin politica guardan siempre', () => {
  assert.equal(debePersistir('alarma', 3, { zonas: [] }, 1), true);
  assert.equal(debePersistir('alarma', 3, { zonas: [] }, 2), true);
});
