import test from 'node:test';
import assert from 'node:assert/strict';
import { validarAjusteLuz } from './lightParams.js';

test('ajustes validos se normalizan', () => {
  assert.deepEqual(validarAjusteLuz({ brillo: 60 }).parametros, { brillo: 60 });
  assert.deepEqual(validarAjusteLuz({ temperatura_k: 3000, brillo: 1 }).parametros, { temperatura_k: 3000, brillo: 1 });
  assert.deepEqual(validarAjusteLuz({ color: '#FF6A00' }).parametros, { color: '#ff6a00' });
});

test('ajustes invalidos se rechazan', () => {
  for (const malo of [
    null, [], {}, { brillo: 0 }, { brillo: 101 }, { brillo: 50.5 }, { brillo: '50' },
    { temperatura_k: 1999 }, { temperatura_k: 7000 },
    { color: 'red' }, { color: '#ff6a0' }, { color: '#ff6a00; drop' },
    { temperatura_k: 3000, color: '#ffffff' }, { brillo: 50, efecto: 'arcoiris' },
  ]) {
    assert.ok(validarAjusteLuz(malo).error, `deberia rechazar ${JSON.stringify(malo)}`);
  }
});
