import { randomBytes } from 'node:crypto';

const clips = new Map();
const VIGENCIA_MS = 5 * 60 * 1000;

export function crearClip(dispositivoId) {
  const ahora = Date.now();
  for (const [id, clip] of clips) if (clip.expira <= ahora) clips.delete(id);
  if (clips.size >= 4) return null;
  if ([...clips.values()].some((c) => c.dispositivoId === String(dispositivoId) && !c.video && !c.error)) return null;
  const id = randomBytes(16).toString('hex');
  clips.set(id, { dispositivoId: String(dispositivoId), expira: ahora + VIGENCIA_MS });
  setTimeout(() => clips.delete(id), VIGENCIA_MS).unref();
  return id;
}

export function leerClip(id, dispositivoId) {
  const clip = clips.get(id);
  if (!clip || clip.dispositivoId !== String(dispositivoId) || clip.expira <= Date.now()) return null;
  return clip;
}

export function eliminarClip(id) {
  clips.delete(id);
}
