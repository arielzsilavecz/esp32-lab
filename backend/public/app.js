const listEl = document.getElementById('dispositivos');
const COOLDOWN_MS = 3000; // igual al cooldown del firmware -- ver Config.h

// Sin boton propio de instalacion: sin el listener de beforeinstallprompt que
// lo armaba, el navegador vuelve a mostrar su propio icono nativo de
// instalar (barra de direcciones/menu) para una PWA instalable -- no hace
// falta nada mas para que siga siendo instalable.
const serviceWorkerRegistration = 'serviceWorker' in navigator
  ? navigator.serviceWorker.register('/service-worker.js')
  : Promise.resolve(null);

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

function base64UrlToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo completar la operacion');
  return body;
}

async function saveNotificationState(subscription, enabled) {
  const response = await api('/api/notificaciones/suscripcion', {
    method: 'PUT',
    body: JSON.stringify({ subscription, enabled }),
  });
  return responseJson(response);
}

async function enableNotifications(registration) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Las notificaciones estan bloqueadas en Chrome');
  }

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const response = await api('/api/notificaciones/public-key');
    const { publicKey } = await responseJson(response);
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    });
  }

  await saveNotificationState(subscription, true);
}

async function disableNotifications(registration) {
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await saveNotificationState(subscription, false);
}

function crearControlNotificaciones() {
  const container = document.createElement('div');
  container.className = 'modo-afuera';

  const copy = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'modo-afuera-titulo';
  title.textContent = 'Estoy afuera';
  const status = document.createElement('div');
  status.className = 'modo-afuera-estado';
  status.textContent = 'Comprobando notificaciones...';
  copy.append(title, status);

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'toggle';
  toggleLabel.setAttribute('aria-label', 'Activar notificaciones cuando estoy afuera');
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.disabled = true;
  toggle.setAttribute('role', 'switch');
  const slider = document.createElement('span');
  slider.className = 'toggle-slider';
  toggleLabel.append(toggle, slider);
  container.append(copy, toggleLabel);

  serviceWorkerRegistration.then(async (registration) => {
    if (!registration || !('PushManager' in window) || !('Notification' in window)) {
      status.textContent = 'Este navegador no admite notificaciones';
      return;
    }

    try {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const response = await api('/api/notificaciones/estado', {
          method: 'POST',
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        toggle.checked = (await responseJson(response)).enabled;
      }
      status.textContent = toggle.checked
        ? 'Avisos activos · pausa de 5 min'
        : 'Sin avisos en este dispositivo';
      toggle.disabled = false;
    } catch (error) {
      status.textContent = error.message;
    }

    toggle.addEventListener('change', async () => {
      const requestedState = toggle.checked;
      toggle.disabled = true;
      status.textContent = requestedState ? 'Activando...' : 'Desactivando...';

      try {
        if (requestedState) await enableNotifications(registration);
        else await disableNotifications(registration);
        status.textContent = requestedState
          ? 'Avisos activos · pausa de 5 min'
          : 'Sin avisos en este dispositivo';
      } catch (error) {
        toggle.checked = !requestedState;
        status.textContent = error.message;
      } finally {
        toggle.disabled = false;
      }
    });
  }).catch(() => {
    status.textContent = 'No se pudo iniciar la app';
  });

  return container;
}

// Se fija la zona horaria en vez de usar la del navegador: el log es de una
// casa que esta en Argentina, y tiene que leerse igual desde cualquier lado.
const TZ_AR = 'America/Argentina/Buenos_Aires';

function etiquetaHoraAR(fechaIso) {
  const fecha = new Date(fechaIso);
  const dia = fecha.toLocaleDateString('es-AR',
    { timeZone: TZ_AR, weekday: 'short', day: 'numeric', month: 'short' });
  const hora = fecha.toLocaleTimeString('es-AR',
    { timeZone: TZ_AR, hour: '2-digit', hour12: false });
  return `${dia} · ${hora}:00`;
}

function horaExactaAR(fechaIso) {
  return new Date(fechaIso).toLocaleTimeString('es-AR', { timeZone: TZ_AR, hour12: false });
}

// Cada fila del historial es un snapshot completo de las 6 zonas, asi que lo
// que se muestra son las transiciones: se compara cada snapshot con el
// inmediatamente anterior en el tiempo. El mas viejo del lote no tiene con
// que compararse y queda afuera.
function derivarEventos(snapshots) {
  const eventos = [];

  for (let i = 0; i < snapshots.length - 1; i++) {
    const actual = snapshots[i].estado?.zonas ?? [];
    const previo = snapshots[i + 1].estado?.zonas ?? [];

    actual.forEach((activa, indice) => {
      if (activa === previo[indice]) return;
      eventos.push({ createdAt: snapshots[i].created_at, zona: indice + 1, activa });
    });
  }

  return eventos;
}

function mostrarLogZonas(logEl, snapshots) {
  const eventos = derivarEventos(snapshots);
  logEl.innerHTML = '';

  if (eventos.length === 0) {
    logEl.textContent = 'Sin activaciones registradas todavia';
    return;
  }

  let horaMostrada = null;
  let lineas = null;

  for (const evento of eventos) {
    const etiqueta = etiquetaHoraAR(evento.createdAt);
    if (etiqueta !== horaMostrada) {
      horaMostrada = etiqueta;

      const encabezado = document.createElement('div');
      encabezado.className = 'log-hora';
      encabezado.textContent = etiqueta;

      lineas = document.createElement('div');
      logEl.append(encabezado, lineas);
    }

    const hora = document.createElement('span');
    hora.className = 'log-ts';
    hora.textContent = horaExactaAR(evento.createdAt);

    const texto = document.createElement('span');
    texto.textContent = `Zona ${evento.zona} ${evento.activa ? 'activada' : 'en reposo'}`;

    const linea = document.createElement('div');
    linea.className = `log-linea ${evento.activa ? 'log-activa' : 'log-reposo'}`;
    linea.append(hora, texto);
    lineas.appendChild(linea);
  }
}

async function cargarLogZonas(dispositivoId, logEl) {
  const response = await api(`/api/dispositivos/${dispositivoId}/estados`);
  mostrarLogZonas(logEl, await response.json());
}

function conectarEstadoEnVivo() {
  const events = new EventSource('/api/dispositivos/eventos');

  events.addEventListener('estado', (event) => {
    const update = JSON.parse(event.data);
    const view = zoneViews.get(String(update.id));
    if (!view) return;
    mostrarEstadoZonas(view.zonasEl, view.actualizadoEl,
      update.estado, update.estado_actualizado_at);
    // Se relee el log en vez de insertar la linea a mano: derivar la
    // transicion aca obligaria a mantener el estado previo en el navegador, y
    // los cambios de zona son lo bastante espaciados como para que una
    // consulta mas no importe.
    cargarLogZonas(update.id, view.logEl);
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

    if (dispositivo.tipo === 'alarma') {
      const zonasEl = document.createElement('div');
      zonasEl.className = 'zonas';
      const actualizadoEl = document.createElement('div');
      actualizadoEl.className = 'historial';
      const logEl = document.createElement('div');
      logEl.className = 'log-zonas';

      const notificationControl = crearControlNotificaciones();
      card.append(nombre, notificationControl, zonasEl, actualizadoEl, logEl);
      listEl.appendChild(card);

      zoneViews.set(String(dispositivo.id), { zonasEl, actualizadoEl, logEl });
      cargarEstadoZonas(dispositivo.id, zonasEl, actualizadoEl);
      cargarLogZonas(dispositivo.id, logEl);
      setInterval(() => cargarEstadoZonas(dispositivo.id, zonasEl, actualizadoEl),
        ZONE_FALLBACK_REFRESH_MS);
      continue;
    }

    // Dispositivos de accion (el porton): tarjeta compacta, con el nombre y el
    // boton en la misma fila. Ocupaba media pantalla para algo que no se usa a
    // diario, y empujaba el plano de la alarma fuera de la vista.
    card.classList.add('compacto');

    const boton = document.createElement('button');
    boton.textContent = 'Activar';

    const historialEl = document.createElement('div');
    historialEl.className = 'historial';

    boton.addEventListener('click', () => activar(dispositivo.id, boton, historialEl));

    const fila = document.createElement('div');
    fila.className = 'fila-compacta';
    fila.append(nombre, boton);

    card.append(fila, historialEl);
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
