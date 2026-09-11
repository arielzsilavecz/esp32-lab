const listEl = document.getElementById('dispositivos');
const COOLDOWN_MS = 3000; // igual al cooldown del firmware -- ver Config.h

async function api(path, options) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (response.status === 401) {
    window.location.href = '/login.html';
    throw new Error('no autenticado');
  }
  return response;
}

function formatoRelativo(fechaIso) {
  if (!fechaIso) return null;
  const segundos = Math.floor((Date.now() - new Date(fechaIso).getTime()) / 1000);
  if (segundos < 60) return `hace ${segundos}s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos}min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas}h`;
  return new Date(fechaIso).toLocaleDateString('es-AR');
}

async function activar(dispositivoId, boton, historialEl) {
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = 'Enviando...';

  try {
    await api(`/api/dispositivos/${dispositivoId}/comandos`, { method: 'POST' });
    boton.textContent = 'Enviado';
    await cargarHistorial(dispositivoId, historialEl);
  } catch {
    boton.textContent = 'Error, reintentar';
  } finally {
    setTimeout(() => {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }, COOLDOWN_MS);
  }
}

async function cargarHistorial(dispositivoId, historialEl) {
  const response = await api(`/api/dispositivos/${dispositivoId}/historial`);
  const historial = await response.json();
  const ultimo = historial[0];
  historialEl.textContent = ultimo
    ? `Ultima activacion: ${ultimo.activado_por}, ${formatoRelativo(ultimo.created_at)}`
    : 'Sin activaciones todavia';
}

// SSE entrega los cambios inmediatamente. Esta consulta lenta solo recupera
// el estado si un evento se perdio durante una reconexion o un redeploy.
const ZONE_FALLBACK_REFRESH_MS = 60000;
const zoneViews = new Map();

const zoneLayout = [
  { numero: 1, clase: 'zona-laser', tipo: 'laser' },
  { numero: 2, clase: 'zona-2', tipo: 'ventana' },
  { numero: 3, clase: 'zona-3', tipo: 'ventana' },
  { numero: 4, clase: 'zona-4', tipo: 'ventana' },
  { numero: 5, clase: 'zona-5', tipo: 'ventana' },
  { numero: 6, clase: 'zona-6', tipo: 'ventana' },
];

function crearPlanoZonas(zonas) {
  const plano = document.createElement('div');
  plano.className = 'plano-alarma';
  plano.setAttribute('role', 'group');
  plano.setAttribute('aria-label', 'Plano de zonas de la alarma');
  plano.innerHTML = `
    <svg class="perimetro" viewBox="0 0 420 330" aria-hidden="true">
      <path d="M35 75 H300 V35 H395 V175 H185 V215 H315 V305 H35 Z" />
    </svg>
    <div class="abertura puerta"><span>Puerta</span></div>
    <div class="abertura ventana-sin-zona"><span>Ventana</span></div>
    <div class="abertura ventana-superior-secundaria"><span>Ventana</span></div>
  `;

  zoneLayout.forEach(({ numero, clase, tipo }) => {
    const activa = zonas?.[numero - 1];
    const sensor = document.createElement('div');
    const estado = activa === true ? 'zona-activa' :
      activa === false ? 'zona-reposo' : 'zona-desconocida';
    sensor.className = `sensor-zona ${tipo} ${clase} ${estado}`;
    sensor.setAttribute('aria-label',
      `Zona ${numero}: ${activa === true ? 'activada' : activa === false ? 'en reposo' : 'sin datos'}`);

    const etiqueta = document.createElement('span');
    etiqueta.textContent = `Z${numero}`;
    sensor.appendChild(etiqueta);
    plano.appendChild(sensor);
  });

  return plano;
}

function mostrarEstadoZonas(zonasEl, actualizadoEl, estado, estadoActualizadoAt) {
  const zonas = estado?.zonas;

  zonasEl.innerHTML = '';
  zonasEl.appendChild(crearPlanoZonas(zonas));

  actualizadoEl.textContent = estadoActualizadoAt
    ? `Ultimo cambio reportado ${formatoRelativo(estadoActualizadoAt)}`
    : 'Esperando al dispositivo...';
}

async function cargarEstadoZonas(dispositivoId, zonasEl, actualizadoEl) {
  const response = await api(`/api/dispositivos/${dispositivoId}/estado`);
  const { estado, estado_actualizado_at } = await response.json();
  mostrarEstadoZonas(zonasEl, actualizadoEl, estado, estado_actualizado_at);
}

function conectarEstadoEnVivo() {
  const events = new EventSource('/api/dispositivos/eventos');

  events.addEventListener('estado', (event) => {
    const update = JSON.parse(event.data);
    const view = zoneViews.get(String(update.id));
    if (!view) return;
    mostrarEstadoZonas(view.zonasEl, view.actualizadoEl,
      update.estado, update.estado_actualizado_at);
  });
}

async function init() {
  const response = await api('/api/dispositivos');
  const dispositivos = await response.json();

  if (dispositivos.length === 0) {
    listEl.textContent = 'No hay dispositivos dados de alta todavia.';
    return;
  }

  for (const dispositivo of dispositivos) {
    const card = document.createElement('div');
    card.className = 'dispositivo';

    const nombre = document.createElement('div');
    nombre.className = 'nombre';
    nombre.textContent = dispositivo.nombre;

    const tipo = document.createElement('div');
    tipo.className = 'tipo';
    tipo.textContent = dispositivo.tipo;

    card.append(nombre, tipo);

    if (dispositivo.tipo === 'alarma') {
      const zonasEl = document.createElement('div');
      zonasEl.className = 'zonas';
      const actualizadoEl = document.createElement('div');
      actualizadoEl.className = 'historial';

      card.append(zonasEl, actualizadoEl);
      listEl.appendChild(card);

      zoneViews.set(String(dispositivo.id), { zonasEl, actualizadoEl });
      cargarEstadoZonas(dispositivo.id, zonasEl, actualizadoEl);
      setInterval(() => cargarEstadoZonas(dispositivo.id, zonasEl, actualizadoEl),
        ZONE_FALLBACK_REFRESH_MS);
      continue;
    }

    const boton = document.createElement('button');
    boton.textContent = 'Activar';

    const historialEl = document.createElement('div');
    historialEl.className = 'historial';

    boton.addEventListener('click', () => activar(dispositivo.id, boton, historialEl));

    card.append(boton, historialEl);
    listEl.appendChild(card);

    cargarHistorial(dispositivo.id, historialEl);
  }

  conectarEstadoEnVivo();
}

document.getElementById('logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

init();
