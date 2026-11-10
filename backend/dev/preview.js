// Vista previa local de la pagina (backend/public) sin base de datos ni deploy.
// Sirve los archivos reales y simula la API con datos falsos: sirve para ver
// cambios de interfaz, NO controla dispositivos reales ni toca produccion.
//
//   npm run preview          -> http://localhost:4600
//   PORT=5000 npm run preview
//
// No hay login: se entra directo al tablero. La verificacion biometrica del
// porton y del disyuntor no se simula (esos botones muestran un error).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT || 4600);

const dispositivos = [
  { id: 1, nombre: 'Portón', tipo: 'porton' },
  { id: 2, nombre: 'Alarma', tipo: 'alarma' },
  { id: 3, nombre: 'NEO', tipo: 'servidor' },
  { id: 4, nombre: 'Luz 1', tipo: 'luz' },
  { id: 5, nombre: 'Luz 2', tipo: 'luz' },
  { id: 6, nombre: 'Disyuntor oficina', tipo: 'disyuntor' },
];
const estados = {
  2: { zonas: [false, false, true, false, false, false], temperaturaC: 41.3 },
  3: { cpu_c: 52.4, gpu_c: 51, load1: 0.18, ram_pct: 14, bateria_pct: 97, enchufado: true, nucleos_mhz: [1396, 1420], disco_ssd_pct: 6, disco_hdd_pct: 1 },
  4: { encendido: true, brillo: 65 },
  5: { encendido: false, brillo: 49 },
  6: { encendido: true, potencia_w: 118, tension_v: 227.1, corriente_a: 0.52, energia_kwh: 424.08 },
};
const actualizado = {};

// Canal en vivo, igual que /api/dispositivos/eventos del backend real.
const clientesSse = new Set();
function publicar(id) {
  actualizado[id] = new Date().toISOString();
  const d = dispositivos.find((x) => x.id === Number(id));
  const evento = JSON.stringify({ ...d, estado: estados[id], estado_actualizado_at: actualizado[id] });
  for (const res of clientesSse) res.write(`event: estado\ndata: ${evento}\n\n`);
}

// El disyuntor real reporta cada ~5 s: se simula una potencia que oscila.
setInterval(() => {
  const e = estados[6];
  e.potencia_w = e.encendido ? Math.round(100 + Math.random() * 60) : 0;
  e.corriente_a = +(e.potencia_w / e.tension_v).toFixed(2);
  e.energia_kwh = +(e.energia_kwh + e.potencia_w * 5 / 3600 / 1000).toFixed(3);
  publicar(6);
}, 5000);

// NEO: una lectura por minuto, con un pico de carga (temperatura y nucleos a
// tope) y un hueco de 20 min apagado, para ver como se dibujan.
function lecturaNeo(t) {
  const min = Math.floor(t / 60000);
  const pico = min % 1440 > 600 && min % 1440 < 640;
  const ruido = (n) => Math.sin(min / n) * 0.5 + 0.5 + (Math.sin(min * 1.7) * 0.04);
  return {
    cpu_c: +(pico ? 60 + 25 * ruido(7) : 38 + 12 * ruido(31)).toFixed(1),
    ram_pct: Math.round(12 + 3 * ruido(90) + (pico ? 9 : 0)),
    nucleos_mhz: pico ? [1896, 1896] : [Math.round(1296 + 600 * ruido(13)), Math.round(1296 + 600 * ruido(17))],
    load1: +(pico ? 1.8 + ruido(9) : 0.05 + 0.3 * ruido(23)).toFixed(2),
    bateria_pct: 97, enchufado: true, disco_ssd_pct: 6, disco_hdd_pct: 1,
  };
}

function historialNeo(horas) {
  const filas = [];
  for (let t = Date.now() - horas * 3600e3; t <= Date.now(); t += 60000) {
    const hace = (Date.now() - t) / 60000;
    if (hace > 300 && hace < 320) continue; // NEO apagado un rato
    filas.push({ estado: lecturaNeo(t), created_at: new Date(t).toISOString() });
  }
  return filas.reverse();
}

setInterval(() => {
  Object.assign(estados[3], lecturaNeo(Date.now()));
  publicar(3);
}, 60000);

function historialDisyuntor() {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const filas = [{ estado: { encendido: true, potencia_w: 70, energia_kwh: 421.9 }, created_at: new Date(inicio - 60000).toISOString() }];
  let energia = 421.9;
  for (let m = 0; m <= (Date.now() - inicio) / 60000; m += 10) {
    const h = m / 60;
    const w = Math.round(60 + 40 * Math.sin(h / 3) + (h > 8 && h < 18 ? 220 : 0) + (h > 19 && h < 22 ? 380 : 0) + 25 * Math.sin(m));
    energia += (w * 10) / 60 / 1000;
    filas.push({ estado: { encendido: true, potencia_w: w, energia_kwh: +energia.toFixed(3) }, created_at: new Date(inicio.getTime() + m * 60000).toISOString() });
  }
  return filas.reverse();
}

function historialAlarma() {
  return [0, 1, 2, 3, 4].map((i) => ({
    estado: { zonas: [false, false, i % 2 === 0, false, i === 3, false] },
    created_at: new Date(Date.now() - i * 47 * 60000).toISOString(),
  }));
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const leerCuerpo = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (d) => { s += d; });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
});

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://local').pathname;
  let m;

  if (p === '/api/dispositivos') return json(res, 200, dispositivos);
  if (p === '/api/dispositivos/conexion') {
    return json(res, 200, dispositivos.map((d) => ({ id: d.id, last_seen_at: new Date().toISOString(), conectado: true })));
  }
  if (p === '/api/dispositivos/eventos') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('retry: 3000\n\n');
    clientesSse.add(res);
    req.on('close', () => clientesSse.delete(res));
    return;
  }
  if ((m = p.match(/^\/api\/dispositivos\/(\d+)\/estado$/))) {
    return json(res, 200, { estado: estados[m[1]] ?? null, estado_actualizado_at: actualizado[m[1]] ?? new Date(Date.now() - 40000).toISOString() });
  }
  if ((m = p.match(/^\/api\/dispositivos\/(\d+)\/estados$/))) {
    const horas = Number(new URL(req.url, 'http://local').searchParams.get('horas'));
    if (m[1] === '3') return json(res, 200, historialNeo(horas === 24 ? 24 : 1));
    return json(res, 200, m[1] === '6' ? historialDisyuntor() : m[1] === '2' ? historialAlarma() : []);
  }
  if ((m = p.match(/^\/api\/dispositivos\/(\d+)\/historial$/))) {
    const t = Date.now() - 3 * 3600000;
    return json(res, 200, [{ id: 9, tipo_comando: 'activar', activado_por: 'Ariel', created_at: new Date(t).toISOString(), consumido_at: new Date(t + 900).toISOString(), expires_at: new Date(t + 5000).toISOString() }]);
  }
  if ((m = p.match(/^\/api\/dispositivos\/(\d+)\/comandos$/)) && req.method === 'POST') {
    const { tipo_comando: tipo } = await leerCuerpo(req);
    const e = estados[m[1]];
    if (!e || !('encendido' in e)) return json(res, 403, { error: 'Vista previa: la verificación biométrica no se simula' });
    if (m[1] === '6' && tipo === 'apagar') return json(res, 403, { error: 'Vista previa: la verificación biométrica no se simula' });
    // Como el puente real: el cambio llega por el canal en vivo un instante despues.
    setTimeout(() => {
      e.encendido = tipo === 'alternar' ? !e.encendido : tipo === 'encender';
      publicar(m[1]);
    }, 600);
    return json(res, 201, { id: Date.now(), created_at: new Date().toISOString() });
  }
  if ((m = p.match(/^\/api\/dispositivos\/(\d+)$/)) && req.method === 'PATCH') {
    const nombre = String((await leerCuerpo(req)).nombre || '').trim().replace(/\s+/g, ' ');
    if (!nombre || nombre.length > 40) return json(res, 400, { error: 'El nombre debe tener entre 1 y 40 caracteres' });
    const d = dispositivos.find((x) => String(x.id) === m[1] && x.tipo === 'luz');
    if (!d) return json(res, 404, { error: 'Foco no encontrado' });
    d.nombre = nombre;
    return json(res, 200, { id: d.id, nombre });
  }
  if (p === '/api/notificaciones/estado') {
    return json(res, 200, { enabled: false, alertasServidor: false, schedule: { enabled: false, days: [1, 2, 3, 4, 5], start: '00:00', end: '08:00' } });
  }
  if (p === '/api/auth/logout') return json(res, 200, { ok: true });
  if (p.startsWith('/api/')) return json(res, 404, { error: 'Vista previa: esta función no se simula' });

  const archivo = path.join(PUBLIC, p === '/' ? 'index.html' : p);
  if (!archivo.startsWith(PUBLIC + path.sep) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  // Sin cache: cada recarga trae el CSS/JS recien editado.
  res.writeHead(200, { 'Content-Type': `${TIPOS[path.extname(archivo)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
  fs.createReadStream(archivo).pipe(res);
}).listen(PORT, () => console.log(`Vista previa en http://localhost:${PORT} (datos falsos, sin produccion)`));
