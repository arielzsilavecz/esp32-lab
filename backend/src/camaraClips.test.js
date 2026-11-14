import test from 'node:test';
import assert from 'node:assert/strict';
import { crearClip, leerClip } from './camaraClips.js';

test('clips pertenecen a una cámara y no se duplican en preparación', () => {
  const id = crearClip(42);
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.ok(leerClip(id, 42));
  assert.equal(leerClip(id, 43), null);
  assert.equal(crearClip(42), null);
  leerClip(id, 42).error = 'No disponible';
  assert.ok(crearClip(42));
});
