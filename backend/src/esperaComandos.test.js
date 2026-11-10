import test from 'node:test';
import assert from 'node:assert/strict';
import { avisarOrden, despertarTodos, dispositivoEsperando, esperarAviso } from './esperaComandos.js';

test('una orden despierta solo a su dispositivo', async () => {
  const a = esperarAviso(1, 1000);
  const b = esperarAviso(2, 60);
  assert.equal(dispositivoEsperando(1), true);
  avisarOrden(1);
  assert.equal(await a, true);
  assert.equal(await b, false); // vence: no era para el
  assert.equal(dispositivoEsperando(1), false);
  assert.equal(dispositivoEsperando(2), false);
});

test('despertar general y corte de conexion', async () => {
  const a = esperarAviso(3, 1000);
  despertarTodos();
  assert.equal(await a, true);

  const corte = new AbortController();
  const b = esperarAviso(4, 1000, corte.signal);
  corte.abort();
  assert.equal(await b, false);
  assert.equal(dispositivoEsperando(4), false);
});
