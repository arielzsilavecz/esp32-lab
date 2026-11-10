const listEl = document.getElementById('dispositivos');
const temperaturaEl = document.getElementById('temperatura-interna');
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

function base64UrlABuffer(valor) {
  const base64 = valor.replace(/-/g, '+').replace(/_/g, '/');
  const binario = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binario, (caracter) => caracter.charCodeAt(0));
}

function bufferABase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function opcionesRegistroParaNavegador(options) {
  return {
    ...options,
    challenge: base64UrlABuffer(options.challenge),
    user: { ...options.user, id: base64UrlABuffer(options.user.id) },
    excludeCredentials: (options.excludeCredentials ?? []).map((credencial) => ({
      ...credencial,
      id: base64UrlABuffer(credencial.id),
    })),
  };
}

function opcionesAutenticacionParaNavegador(options) {
  return {
    ...options,
    challenge: base64UrlABuffer(options.challenge),
    allowCredentials: (options.allowCredentials ?? []).map((credencial) => ({
      ...credencial,
      id: base64UrlABuffer(credencial.id),
    })),
  };
}

function serializarCredencial(credencial) {
  const response = credencial.response;
  const respuesta = {
    clientDataJSON: bufferABase64Url(response.clientDataJSON),
  };

  if ('attestationObject' in response) {
    respuesta.attestationObject = bufferABase64Url(response.attestationObject);
    respuesta.transports = response.getTransports?.() ?? [];
  } else {
    respuesta.authenticatorData = bufferABase64Url(response.authenticatorData);
    respuesta.signature = bufferABase64Url(response.signature);
    respuesta.userHandle = response.userHandle ? bufferABase64Url(response.userHandle) : undefined;
  }

  return {
    id: credencial.id,
    rawId: bufferABase64Url(credencial.rawId),
    type: credencial.type,
    authenticatorAttachment: credencial.authenticatorAttachment,
    clientExtensionResults: credencial.getClientExtensionResults(),
    response: respuesta,
  };
}

async function exigirRespuestaExitosa(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'La operación falló');
  return body;
}

async function registrarBiometria(dispositivoId) {
  const options = await exigirRespuestaExitosa(await api('/api/webauthn/registro/opciones', {
    method: 'POST',
    body: JSON.stringify({ dispositivoId }),
  }));
  const credential = await navigator.credentials.create({
    publicKey: opcionesRegistroParaNavegador(options),
  });
  if (!credential) throw new Error('No se creó la credencial');

  await exigirRespuestaExitosa(await api('/api/webauthn/registro/verificar', {
    method: 'POST',
    body: JSON.stringify({ dispositivoId, credential: serializarCredencial(credential) }),
  }));
}

async function verificarBiometria(dispositivoId) {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    throw new Error('Este navegador no admite verificación biométrica');
  }

  const optionsResponse = await api('/api/webauthn/autenticacion/opciones', {
    method: 'POST',
    body: JSON.stringify({ dispositivoId }),
  });
  if (optionsResponse.status === 409) {
    await registrarBiometria(dispositivoId);
    return;
  }

  const options = await exigirRespuestaExitosa(optionsResponse);
  const credential = await navigator.credentials.get({
    publicKey: opcionesAutenticacionParaNavegador(options),
  });
  if (!credential) throw new Error('No se verificó la identidad');

  await exigirRespuestaExitosa(await api('/api/webauthn/autenticacion/verificar', {
    method: 'POST',
    body: JSON.stringify({ dispositivoId, credential: serializarCredencial(credential) }),
  }));
}

async function activar(dispositivoId, boton, historialEl) {
  boton.dataset.busy = 'true';
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = 'Verificando...';

  try {
    await verificarBiometria(dispositivoId);
    boton.textContent = 'Enviando...';
    const command = await exigirRespuestaExitosa(await api(`/api/dispositivos/${dispositivoId}/comandos`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    }));
    boton.textContent = 'Esperando ESP32...';
    let confirmado = false;
    const limite = Date.now() + 7000;
    while (Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      const history = await exigirRespuestaExitosa(await api(`/api/dispositivos/${dispositivoId}/historial`, {
        cache: 'no-store', signal: AbortSignal.timeout(3000),
      }));
      if (history.some((item) => item.id === command.id && item.consumido_at)) {
        confirmado = true;
        break;
      }
    }
    boton.textContent = confirmado ? 'ESP32 confirmó' : 'Sin confirmación';
    await cargarHistorial(dispositivoId, historialEl);
    if (!confirmado) historialEl.textContent = 'Sin confirmación del ESP32. La orden no se reenvía; verificá el portón antes de intentar otra vez.';
  } catch (error) {
    boton.textContent = error.name === 'NotAllowedError' ? 'Cancelado' : 'Error, reintentar';
    historialEl.textContent = error.name === 'NotAllowedError' ? 'Verificación cancelada.' : error.message;
  } finally {
    setTimeout(() => {
      delete boton.dataset.busy;
      boton.disabled = boton.dataset.online !== 'true';
      boton.textContent = textoOriginal;
    }, COOLDOWN_MS);
  }
}

async function cargarHistorial(dispositivoId, historialEl) {
  const response = await api(`/api/dispositivos/${dispositivoId}/historial`);
  const historial = await response.json();
  const ultimo = historial[0];
  historialEl.textContent = ultimo
    ? `Última orden: ${ultimo.activado_por}, ${formatoRelativo(ultimo.created_at)} · ${ultimo.consumido_at ? 'ESP32 confirmó' : Date.parse(ultimo.expires_at) <= Date.now() ? 'vencida / sin confirmación' : 'pendiente (máx. 5 s)'}`
    : 'Sin activaciones todavía';
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

function mostrarEstadoZonas(zonasEl, actualizadoEl, temperaturaEl, estado, estadoActualizadoAt) {
  const zonas = estado?.zonas;

  zonasEl.innerHTML = '';
  zonasEl.appendChild(crearPlanoZonas(zonas));

  actualizadoEl.textContent = estadoActualizadoAt
    ? `Último cambio reportado ${formatoRelativo(estadoActualizadoAt)}`
    : 'Esperando al dispositivo...';

  // temperaturaC es la lectura interna del die del ESP32 (no calibrada, no es
  // la temperatura ambiente del gabinete) -- ver ADR-0009. Se oculta el
  // renglon en vez de mostrar "undefined" si el dispositivo todavia no la
  // reporto (p. ej. antes del primer heartbeat tras el arranque).
  temperaturaEl.hidden = estado?.temperaturaC === undefined;
  if (!temperaturaEl.hidden) {
    temperaturaEl.textContent = `Temp. interna ESP32: ${estado.temperaturaC.toFixed(1)}°C`;
  }
}

async function cargarEstadoZonas(dispositivoId, zonasEl, actualizadoEl, temperaturaEl) {
  const response = await api(`/api/dispositivos/${dispositivoId}/estado`);
  const { estado, estado_actualizado_at } = await response.json();
  mostrarEstadoZonas(zonasEl, actualizadoEl, temperaturaEl, estado, estado_actualizado_at);
}

function base64UrlToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo completar la operación');
  return body;
}

async function saveNotificationState(subscription, enabled) {
  const response = await api('/api/notificaciones/suscripcion', {
    method: 'PUT',
    body: JSON.stringify({ subscription, enabled }),
  });
  return responseJson(response);
}

async function getOrCreatePushSubscription(registration) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Las notificaciones están bloqueadas en Chrome');
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

  return subscription;
}

async function enableNotifications(registration) {
  const subscription = await getOrCreatePushSubscription(registration);
  await saveNotificationState(subscription, true);
}

async function disableNotifications(registration) {
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await saveNotificationState(subscription, false);
}

// Luces y disyuntor llegan por el puente de NEO (Home Assistant -> backend).
// Cada tarjeta registra aca como reflejar un update SSE de su dispositivo.
const liveViews = new Map();

async function enviarComando(dispositivoId, tipoComando) {
  return exigirRespuestaExitosa(await api(`/api/dispositivos/${dispositivoId}/comandos`, {
    method: 'POST',
    body: JSON.stringify({ tipo_comando: tipoComando }),
    signal: AbortSignal.timeout(5000),
  }));
}

async function leerEstado(dispositivoId) {
  return exigirRespuestaExitosa(await api(`/api/dispositivos/${dispositivoId}/estado`, { cache: 'no-store' }));
}

// Para luces y disyuntor la confirmacion util no es "comando consumido" sino
// que Home Assistant reporte el estado pedido.
async function esperarEncendido(dispositivoId, encendido) {
  const limite = Date.now() + 7000;
  while (Date.now() < limite) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const { estado } = await leerEstado(dispositivoId);
    if (estado?.encendido === encendido) return true;
  }
  return false;
}

function crearBotonEncendido(dispositivo, { verificarAlApagar = false, texto }) {
  const boton = document.createElement('button');
  boton.className = verificarAlApagar ? 'boton-estado boton-critico' : 'boton-estado';
  boton.disabled = true;
  boton.textContent = '...';
  let encendido = null;

  // data-on: encendido -> el boton ofrece apagar (contorno); apagado -> encender (relleno).
  const mostrar = (valor) => {
    encendido = typeof valor === 'boolean' ? valor : null;
    boton.dataset.on = String(encendido === true);
    if (boton.dataset.busy) return;
    boton.disabled = encendido === null;
    boton.textContent = encendido === null ? 'Sin datos' : texto(encendido);
  };

  // alConfirmar repinta la tarjeta entera (indicador, metricas) sin depender del
  // evento SSE, que puede perderse en una reconexion. Si fallo, solo se
  // actualiza el boton para no tapar el mensaje de error.
  const ejecutar = async (estadoEl, alConfirmar) => {
    const objetivo = !encendido;
    let confirmado = false;
    boton.dataset.busy = 'true';
    boton.disabled = true;
    try {
      if (!objetivo && verificarAlApagar) {
        boton.textContent = 'Verificando...';
        await verificarBiometria(dispositivo.id);
      }
      boton.textContent = 'Enviando...';
      await enviarComando(dispositivo.id, objetivo ? 'encender' : 'apagar');
      confirmado = await esperarEncendido(dispositivo.id, objetivo);
      if (!confirmado) {
        estadoEl.textContent = 'Sin confirmación de NEO. Revisá el estado antes de reintentar.';
      }
    } catch (error) {
      estadoEl.textContent = error.name === 'NotAllowedError' ? 'Verificación cancelada.' : error.message;
    } finally {
      delete boton.dataset.busy;
      const { estado, estado_actualizado_at } = await leerEstado(dispositivo.id).catch(() => ({}));
      if (confirmado && alConfirmar) alConfirmar(estado, estado_actualizado_at);
      else mostrar(estado?.encendido);
    }
  };
  return { boton, mostrar, ejecutar };
}

function crearTarjetaLuz(dispositivo, grupo, nombre) {
  const estadoEl = document.createElement('div');
  estadoEl.className = 'historial';
  const control = crearBotonEncendido(dispositivo, { texto: (on) => (on ? 'Apagar' : 'Encender') });
  control.boton.addEventListener('click', () => control.ejecutar(estadoEl, (e, at) => mostrar(e, at)));

  const indicador = document.createElement('span');
  indicador.className = 'indicador-luz';
  indicador.setAttribute('aria-hidden', 'true');
  const texto = document.createElement('div');
  texto.className = 'fila-luz-texto';
  texto.append(nombre, estadoEl);

  const fila = document.createElement('div');
  fila.className = 'fila-luz';
  fila.append(indicador, texto, control.boton);
  grupo.append(fila);

  const mostrar = (estado, at) => {
    control.mostrar(estado?.encendido);
    fila.dataset.on = String(estado?.encendido === true);
    estadoEl.textContent = estado
      ? `${estado.encendido ? 'Encendida' : 'Apagada'}${typeof estado.brillo === 'number' ? ` · brillo ${estado.brillo}%` : ''} · ${horaExactaAR(at)}`
      : 'Sin datos de NEO todavía';
  };
  liveViews.set(String(dispositivo.id), (u) => mostrar(u.estado, u.estado_actualizado_at));
  leerEstado(dispositivo.id).then(({ estado, estado_actualizado_at }) => mostrar(estado, estado_actualizado_at));
}

function minutosDelDiaAR(iso) {
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ_AR, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const valor = (tipo) => Number(partes.find((p) => p.type === tipo).value);
  return valor('hour') * 60 + valor('minute');
}

// Grafico de potencia del dia en SVG plano: sin libreria de graficos para una
// sola serie. Eje X 00-24 h (hora de Argentina), eje Y de 0 al maximo del dia.
function dibujarPotencia(contenedor, filas, fecha) {
  const ancho = 300;
  const alto = 110;
  const puntos = filas
    .filter((f) => typeof f.estado?.potencia_w === 'number' && fechaAR(new Date(f.created_at)) === fecha)
    .map((f) => [minutosDelDiaAR(f.created_at), f.estado.potencia_w])
    .sort((a, b) => a[0] - b[0]);
  if (puntos.length === 0) {
    contenedor.textContent = 'Sin registros de potencia ese día.';
    return;
  }
  const maximo = Math.max(1, ...puntos.map((p) => p[1]));
  const x = (minuto) => (minuto / 1440) * ancho;
  const y = (w) => alto - (w / maximo) * (alto - 12);
  const linea = puntos.map(([m, w]) => `${x(m).toFixed(1)},${y(w).toFixed(1)}`).join(' ');
  const marcas = [0, 6, 12, 18, 24].map((h) =>
    `<text x="${x(h * 60)}" y="${alto + 12}" text-anchor="${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}">${String(h).padStart(2, '0')}</text>`).join('');
  // Solo numeros calculados aca: innerHTML no recibe texto del usuario.
  const primero = x(puntos[0][0]).toFixed(1);
  const ultimo = x(puntos.at(-1)[0]).toFixed(1);
  contenedor.innerHTML = `<svg viewBox="0 0 ${ancho} ${alto + 16}" role="img" aria-label="Potencia del día, máximo ${Math.round(maximo)} W">
    <line x1="0" y1="${y(maximo)}" x2="${ancho}" y2="${y(maximo)}" class="guia"/>
    <line x1="0" y1="${y(maximo / 2)}" x2="${ancho}" y2="${y(maximo / 2)}" class="guia"/>
    <line x1="0" y1="${alto}" x2="${ancho}" y2="${alto}" class="eje"/>
    <polygon points="${primero},${alto} ${linea} ${ultimo},${alto}" class="area"/>
    <polyline points="${linea}" class="serie"/>
    <text x="2" y="${y(maximo) - 3}">${Math.round(maximo)} W</text>
    <text x="2" y="${y(maximo / 2) - 3}">${Math.round(maximo / 2)} W</text>${marcas}</svg>`;
}

function crearTarjetaDisyuntor(dispositivo, card, nombre) {
  const control = crearBotonEncendido(dispositivo, {
    verificarAlApagar: true,
    texto: (on) => (on ? 'Cortar' : 'Conectar'),
  });
  const fila = document.createElement('div');
  fila.className = 'fila-compacta';
  fila.append(nombre, control.boton);

  const metricas = document.createElement('div');
  metricas.className = 'metricas';
  const campos = [
    ['potencia_w', 'Potencia', 'W', 0],
    ['tension_v', 'Tensión', 'V', 0],
    ['corriente_a', 'Corriente', 'A', 2],
    ['energia_kwh', 'Energía total', 'kWh', 2],
  ];
  const valores = new Map();
  // Misma ficha que NEO (crearValorNeo en servidor.js): titulo arriba, dato abajo, centrados.
  for (const [clave, etiqueta] of campos) {
    const ficha = crearValorNeo(etiqueta);
    metricas.appendChild(ficha.el);
    valores.set(clave, ficha.valor);
  }

  const estadoEl = document.createElement('div');
  estadoEl.className = 'historial';
  const resumenEl = document.createElement('div');
  resumenEl.className = 'historial';
  const graficoEl = document.createElement('div');
  graficoEl.className = 'grafico';

  const cargarDia = async (fecha) => {
    const filas = await exigirRespuestaExitosa(await api(`/api/dispositivos/${dispositivo.id}/estados?fecha=${fecha}`));
    // Viene del mas nuevo al mas viejo e incluye el ultimo registro del dia
    // anterior, que sirve de base para calcular la energia del dia.
    const energias = filas.map((f) => f.estado?.energia_kwh).filter((v) => typeof v === 'number').reverse();
    resumenEl.textContent = energias.length > 1
      ? `Consumo del día: ${Math.max(0, energias.at(-1) - energias[0]).toFixed(2)} kWh`
      : 'Consumo del día: sin datos suficientes';
    dibujarPotencia(graficoEl, filas, fecha);
  };
  const fechaEl = crearSelectorFecha((fecha) => cargarDia(fecha).catch((e) => { resumenEl.textContent = e.message; }));
  control.boton.addEventListener('click', () => control.ejecutar(estadoEl, (e, at) => mostrar(e, at)));
  card.append(fila, metricas, estadoEl, fechaEl, resumenEl, graficoEl);

  const mostrar = (estado, at) => {
    control.mostrar(estado?.encendido);
    for (const [clave, , unidad, decimales] of campos) {
      const v = estado?.[clave];
      valores.get(clave).textContent = typeof v === 'number' ? `${numeroEs(v, decimales)} ${unidad}` : '–';
    }
    estadoEl.textContent = estado
      ? `${estado.encendido ? 'Conectado' : 'Cortado'} · ${horaExactaAR(at)}`
      : 'Sin datos de NEO todavía';
  };
  liveViews.set(String(dispositivo.id), (u) => mostrar(u.estado, u.estado_actualizado_at));
  leerEstado(dispositivo.id).then(({ estado, estado_actualizado_at }) => mostrar(estado, estado_actualizado_at));
  cargarDia(fechaEl.value).catch((error) => { resumenEl.textContent = error.message; });
  // El historial se guarda 1 vez por minuto: refrescar el grafico mas seguido no aporta.
  setInterval(() => {
    if (fechaEl.value === fechaAR()) cargarDia(fechaEl.value).catch(() => {});
  }, 60000);
}

function crearControlAlertasServidor() {
  const manual = document.createElement('div');
  manual.className = 'modo-afuera';
  const copy = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'modo-afuera-titulo';
  title.textContent = 'Avisarme de NEO';
  const status = document.createElement('div');
  status.className = 'modo-afuera-estado';
  status.textContent = 'Comprobando notificaciones...';
  copy.append(title, status);

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'toggle';
  toggleLabel.setAttribute('aria-label', 'Recibir alertas de temperatura y caída de NEO');
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.disabled = true;
  toggle.setAttribute('role', 'switch');
  const slider = document.createElement('span');
  slider.className = 'toggle-slider';
  toggleLabel.append(toggle, slider);
  manual.append(copy, toggleLabel);

  const textoActivo = 'Avisos si CPU >= 85°C o sin reportar 3 min';
  const textoInactivo = 'Sin avisos de NEO en este dispositivo';

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
        toggle.checked = (await responseJson(response)).alertasServidor === true;
      }
      status.textContent = toggle.checked ? textoActivo : textoInactivo;
      toggle.disabled = false;
    } catch (error) {
      status.textContent = error.message;
    }

    toggle.addEventListener('change', async () => {
      const requested = toggle.checked;
      toggle.disabled = true;
      status.textContent = requested ? 'Activando...' : 'Desactivando...';
      try {
        const subscription = requested
          ? await getOrCreatePushSubscription(registration)
          : await registration.pushManager.getSubscription();
        if (subscription) {
          const response = await api('/api/notificaciones/alertas-servidor', {
            method: 'PUT',
            body: JSON.stringify({ subscription, enabled: requested }),
          });
          await responseJson(response);
        }
        status.textContent = requested ? textoActivo : textoInactivo;
      } catch (error) {
        toggle.checked = !requested;
        status.textContent = error.message;
      } finally {
        toggle.disabled = false;
      }
    });
  });

  return manual;
}

function crearControlNotificaciones() {
  const settings = document.createElement('div');
  settings.className = 'notificaciones-config';

  const manual = document.createElement('div');
  manual.className = 'modo-afuera';

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
  manual.append(copy, toggleLabel);

  const schedule = document.createElement('details');
  schedule.className = 'programacion';
  const scheduleSummary = document.createElement('summary');
  scheduleSummary.textContent = 'Programar avisos';

  const scheduleBody = document.createElement('div');
  scheduleBody.className = 'programacion-cuerpo';
  const daysTitle = document.createElement('div');
  daysTitle.className = 'programacion-etiqueta';
  daysTitle.textContent = 'Días';
  const daysContainer = document.createElement('div');
  daysContainer.className = 'programacion-dias';
  const dayInputs = new Map();
  const dayOptions = [
    [1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [7, 'D'],
  ];
  for (const [value, label] of dayOptions) {
    const dayLabel = document.createElement('label');
    const dayInput = document.createElement('input');
    dayInput.type = 'checkbox';
    dayInput.value = value;
    dayInput.checked = value <= 5;
    const dayText = document.createElement('span');
    dayText.textContent = label;
    dayLabel.append(dayInput, dayText);
    daysContainer.appendChild(dayLabel);
    dayInputs.set(value, dayInput);
  }

  const times = document.createElement('div');
  times.className = 'programacion-horas';
  const startLabel = document.createElement('label');
  startLabel.textContent = 'Desde';
  const startInput = document.createElement('input');
  startInput.type = 'time';
  startInput.value = '00:00';
  startLabel.appendChild(startInput);
  const endLabel = document.createElement('label');
  endLabel.textContent = 'Hasta';
  const endInput = document.createElement('input');
  endInput.type = 'time';
  endInput.value = '08:00';
  endLabel.appendChild(endInput);
  times.append(startLabel, endLabel);

  const scheduleEnabledLabel = document.createElement('label');
  scheduleEnabledLabel.className = 'programacion-habilitada';
  const scheduleEnabled = document.createElement('input');
  scheduleEnabled.type = 'checkbox';
  const scheduleEnabledText = document.createElement('span');
  scheduleEnabledText.textContent = 'Activar este horario';
  scheduleEnabledLabel.append(scheduleEnabled, scheduleEnabledText);

  const saveSchedule = document.createElement('button');
  saveSchedule.type = 'button';
  saveSchedule.textContent = 'Guardar horario';
  saveSchedule.disabled = true;
  const scheduleStatus = document.createElement('div');
  scheduleStatus.className = 'programacion-estado';
  scheduleStatus.textContent = 'Horario de Argentina';

  scheduleBody.append(daysTitle, daysContainer, times, scheduleEnabledLabel,
    saveSchedule, scheduleStatus);
  schedule.append(scheduleSummary, scheduleBody);
  settings.append(manual, schedule);

  function applySchedule(saved = {}) {
    const days = saved.days || [1, 2, 3, 4, 5];
    for (const [day, input] of dayInputs) input.checked = days.includes(day);
    startInput.value = saved.start || '00:00';
    endInput.value = saved.end || '08:00';
    scheduleEnabled.checked = saved.enabled === true;
    scheduleSummary.textContent = scheduleEnabled.checked
      ? 'Programar avisos · activo'
      : 'Programar avisos';
  }

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
        const saved = await responseJson(response);
        toggle.checked = saved.enabled;
        applySchedule(saved.schedule);
      }
      status.textContent = toggle.checked
        ? 'Avisos activos · pausa de 5 min'
        : 'Sin avisos en este dispositivo';
      toggle.disabled = false;
      saveSchedule.disabled = false;
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

    saveSchedule.addEventListener('click', async () => {
      const days = [...dayInputs]
        .filter(([, input]) => input.checked)
        .map(([day]) => day);
      const enabled = scheduleEnabled.checked;

      if (enabled && days.length === 0) {
        scheduleStatus.textContent = 'Elegí al menos un día';
        return;
      }
      if (enabled && startInput.value === endInput.value) {
        scheduleStatus.textContent = 'Las horas de inicio y fin deben ser distintas';
        return;
      }

      saveSchedule.disabled = true;
      scheduleStatus.textContent = 'Guardando...';
      try {
        let subscription = await registration.pushManager.getSubscription();
        if (enabled) subscription = await getOrCreatePushSubscription(registration);
        if (!subscription) {
          scheduleStatus.textContent = 'Horario desactivado';
          return;
        }

        const response = await api('/api/notificaciones/programacion', {
          method: 'PUT',
          body: JSON.stringify({
            subscription,
            enabled,
            days,
            start: startInput.value,
            end: endInput.value,
          }),
        });
        await responseJson(response);
        scheduleSummary.textContent = enabled
          ? 'Programar avisos · activo'
          : 'Programar avisos';
        scheduleStatus.textContent = enabled
          ? 'Horario activo · hora de Argentina'
          : 'Horario desactivado';
      } catch (error) {
        scheduleStatus.textContent = error.message;
      } finally {
        saveSchedule.disabled = false;
      }
    });
  }).catch(() => {
    status.textContent = 'No se pudo iniciar la app';
  });

  return settings;
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
  const horasAbiertas = new Set(
    [...logEl.querySelectorAll('.log-grupo-hora[open]')].map((grupo) => grupo.dataset.hora)
  );
  logEl.innerHTML = '';

  if (eventos.length === 0) {
    logEl.textContent = 'Sin activaciones este día';
    return;
  }

  const grupos = new Map();

  for (const evento of eventos) {
    const etiqueta = etiquetaHoraAR(evento.createdAt);
    if (!grupos.has(etiqueta)) {
      grupos.set(etiqueta, []);
    }
    grupos.get(etiqueta).push(evento);
  }

  for (const [etiqueta, eventosHora] of grupos) {
    const grupo = document.createElement('details');
    grupo.className = 'log-grupo-hora';
    grupo.dataset.hora = etiqueta;
    grupo.open = horasAbiertas.has(etiqueta);

    const encabezado = document.createElement('summary');
    encabezado.className = 'log-hora';
    encabezado.textContent = etiqueta;

    const lineas = document.createElement('div');

    for (const evento of eventosHora) {
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

    grupo.append(encabezado, lineas);
    logEl.appendChild(grupo);
  }
}

// en-CA formatea como YYYY-MM-DD, que es lo que esperan <input type="date"> y
// el backend.
function fechaAR(fecha = new Date()) {
  return fecha.toLocaleDateString('en-CA', { timeZone: TZ_AR });
}

async function cargarLogZonas(dispositivoId, logEl, fecha) {
  const response = await api(`/api/dispositivos/${dispositivoId}/estados?fecha=${fecha}`);
  mostrarLogZonas(logEl, await response.json());
}

// Retencion de 60 dias en el backend (retencion.js): mas atras no hay datos.
function crearSelectorFecha(alCambiar) {
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'log-fecha';
  input.setAttribute('aria-label', 'Día del log');
  input.value = input.max = fechaAR();
  input.min = fechaAR(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000));
  input.addEventListener('change', () => {
    if (input.value) alCambiar(input.value);
  });
  return input;
}

function conectarEstadoEnVivo() {
  const events = new EventSource('/api/dispositivos/eventos');

  events.addEventListener('estado', (event) => {
    const update = JSON.parse(event.data);
    liveViews.get(String(update.id))?.(update);
    const view = zoneViews.get(String(update.id));
    if (!view) return;
    mostrarEstadoZonas(view.zonasEl, view.actualizadoEl, view.temperaturaEl,
      update.estado, update.estado_actualizado_at);
    // Se relee el log en vez de insertar la linea a mano: derivar la
    // transicion aca obligaria a mantener el estado previo en el navegador, y
    // los cambios de zona son lo bastante espaciados como para que una
    // consulta mas no importe. Solo si se esta mirando hoy: un dia pasado no
    // cambia.
    if (view.fechaEl.value === fechaAR()) {
      cargarLogZonas(update.id, view.logEl, view.fechaEl.value);
    }
  });
}

// Un solo badge junto al titulo, no uno por tarjeta: alarma y porton son el
// mismo ESP32 fisico desde la consolidacion (ver ADR de consolidacion), asi
// que mostrar "conectado" dos veces era redundante. Se toma el estado del
// porton como referencia porque su polling (1s, umbral de 10s en el backend)
// detecta una desconexion mucho mas rapido que el keep-warm de la alarma
// (45s, umbral de 90s) -- si el porton esta vivo, el equipo esta vivo.
const conexionBadgeEl = document.getElementById('conexion-badge');
const conexionTextoEl = conexionBadgeEl.querySelector('.conexion-texto');
let portonId = null;
let portonBoton = null;
let connectionRequestBusy = false;

async function actualizarConexion() {
  if (connectionRequestBusy || portonId === null) return;
  connectionRequestBusy = true;
  try {
    const estados = await exigirRespuestaExitosa(await api('/api/dispositivos/conexion', {
      cache: 'no-store', signal: AbortSignal.timeout(5000),
    }));
    const estado = estados.find((item) => String(item.id) === portonId);
    const online = estado?.conectado === true;
    conexionBadgeEl.className = `conexion-badge ${online ? 'online' : 'offline'}`;
    conexionTextoEl.textContent = online ? 'ESP32 conectado' : 'ESP32 sin conexión';
    conexionBadgeEl.title = estado?.last_seen_at
      ? `Último contacto: ${new Date(estado.last_seen_at).toLocaleString('es-AR')}`
      : 'Todavía no se recibió una señal de conexión';
    if (portonBoton) {
      portonBoton.dataset.online = String(online);
      portonBoton.disabled = !online || portonBoton.dataset.busy === 'true';
    }
  } catch {
    conexionBadgeEl.className = 'conexion-badge offline';
    conexionTextoEl.textContent = 'Sin conexión con el servidor';
    if (portonBoton) {
      portonBoton.dataset.online = 'false';
      portonBoton.disabled = true;
    }
  } finally {
    connectionRequestBusy = false;
  }
}

const ICONO_EDITAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>';

// Nombre del dispositivo con edicion en el lugar: lapiz -> campo de texto.
// Enter o salir del campo guarda; Escape cancela. Sin modal: es un dato corto.
function crearNombreEditable(dispositivo) {
  const contenedor = document.createElement('div');
  contenedor.className = 'nombre-editable';

  const titulo = document.createElement('h2');
  titulo.className = 'nombre';
  titulo.textContent = dispositivo.nombre;

  const editar = document.createElement('button');
  editar.type = 'button';
  editar.className = 'boton-icono';
  editar.innerHTML = ICONO_EDITAR;
  editar.setAttribute('aria-label', `Cambiar nombre de ${dispositivo.nombre}`);

  const campo = document.createElement('input');
  campo.type = 'text';
  campo.className = 'nombre-campo';
  campo.maxLength = 40;
  campo.hidden = true;
  campo.setAttribute('aria-label', 'Nombre del dispositivo');

  let guardando = false;
  const cerrar = () => {
    campo.hidden = true;
    titulo.hidden = false;
    editar.hidden = false;
  };
  const guardar = async () => {
    if (guardando || campo.hidden) return;
    const nuevo = campo.value.trim().replace(/\s+/g, ' ');
    if (!nuevo || nuevo === dispositivo.nombre) { cerrar(); return; }
    guardando = true;
    campo.disabled = true;
    try {
      const guardado = await exigirRespuestaExitosa(await api(`/api/dispositivos/${dispositivo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nombre: nuevo }),
      }));
      dispositivo.nombre = guardado.nombre;
      titulo.textContent = guardado.nombre;
      editar.setAttribute('aria-label', `Cambiar nombre de ${guardado.nombre}`);
      cerrar();
    } catch (error) {
      campo.setCustomValidity(error.message);
      campo.reportValidity();
    } finally {
      guardando = false;
      campo.disabled = false;
    }
  };

  editar.addEventListener('click', () => {
    campo.value = dispositivo.nombre;
    campo.setCustomValidity('');
    titulo.hidden = true;
    editar.hidden = true;
    campo.hidden = false;
    campo.focus();
    campo.select();
  });
  campo.addEventListener('input', () => campo.setCustomValidity(''));
  campo.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') guardar();
    if (event.key === 'Escape') cerrar();
  });
  campo.addEventListener('blur', guardar);

  contenedor.append(titulo, campo, editar);
  return contenedor;
}

// Orden en celular: lo que se toca a diario arriba. En desktop la alarma ocupa
// la columna principal y el resto va a la lateral (ver .columna en style.css).
const ORDEN_TIPOS = { porton: 1, luz: 2, alarma: 3, disyuntor: 4, servidor: 5 };

async function init() {
  const response = await api('/api/dispositivos');
  const dispositivos = await response.json();

  if (dispositivos.length === 0) {
    listEl.textContent = 'No hay dispositivos dados de alta todavía.';
    return;
  }

  const columnaPrincipal = document.createElement('div');
  columnaPrincipal.className = 'columna columna-principal';
  const columnaLateral = document.createElement('div');
  columnaLateral.className = 'columna columna-lateral';
  listEl.append(columnaPrincipal, columnaLateral);

  let grupoLuces = null;
  const ordenados = [...dispositivos].sort((a, b) =>
    (ORDEN_TIPOS[a.tipo] ?? 9) - (ORDEN_TIPOS[b.tipo] ?? 9) || a.id - b.id);

  for (const dispositivo of ordenados) {
    const card = document.createElement('section');
    card.className = 'dispositivo';
    card.dataset.tipo = dispositivo.tipo;
    const listEl = dispositivo.tipo === 'alarma' ? columnaPrincipal : columnaLateral;

    // Solo los focos se renombran (se mueven de lugar); el resto es fijo.
    let nombre;
    if (dispositivo.tipo === 'luz') {
      nombre = crearNombreEditable(dispositivo);
    } else {
      nombre = document.createElement('h2');
      nombre.className = 'nombre';
      nombre.textContent = dispositivo.nombre;
    }

    // Las luces comparten una tarjeta: una fila por foco, no una tarjeta cada una.
    if (dispositivo.tipo === 'luz') {
      if (!grupoLuces) {
        grupoLuces = card;
        const titulo = document.createElement('h2');
        titulo.className = 'grupo-titulo';
        titulo.textContent = 'Luces';
        grupoLuces.append(titulo);
        listEl.appendChild(grupoLuces);
      }
      crearTarjetaLuz(dispositivo, grupoLuces, nombre);
      continue;
    }

    if (dispositivo.tipo === 'alarma') {
      const zonasEl = document.createElement('div');
      zonasEl.className = 'zonas';
      const actualizadoEl = document.createElement('div');
      actualizadoEl.className = 'historial';
      const logEl = document.createElement('div');
      logEl.className = 'log-zonas';

      const fechaEl = crearSelectorFecha((fecha) => cargarLogZonas(dispositivo.id, logEl, fecha));

      const notificationControl = crearControlNotificaciones();
      card.append(nombre, notificationControl, zonasEl, actualizadoEl, fechaEl, logEl);
      listEl.appendChild(card);

      zoneViews.set(String(dispositivo.id), { zonasEl, actualizadoEl, temperaturaEl, logEl, fechaEl });
      cargarEstadoZonas(dispositivo.id, zonasEl, actualizadoEl, temperaturaEl);
      cargarLogZonas(dispositivo.id, logEl, fechaEl.value);
      setInterval(() => cargarEstadoZonas(dispositivo.id, zonasEl, actualizadoEl, temperaturaEl),
        ZONE_FALLBACK_REFRESH_MS);
      continue;
    }

    if (dispositivo.tipo === 'disyuntor') {
      crearTarjetaDisyuntor(dispositivo, card, nombre);
      listEl.appendChild(card);
      continue;
    }

    // Servidor (NEO): solo lectura, sin boton. Sin esta rama caia en la de
    // accion y se dibujaba como un porton con "Activar" que no hace nada.
    // NEO va arriba de todo y a lo ancho: fuera de las dos columnas (ver servidor.js).
    if (dispositivo.tipo === 'servidor') {
      crearSeccionServidor(dispositivo, card, nombre);
      columnaPrincipal.parentElement.prepend(card);
      continue;
    }

    // Dispositivos de accion (el porton): tarjeta compacta, con el nombre y el
    // boton en la misma fila. Ocupaba media pantalla para algo que no se usa a
    // diario, y empujaba el plano de la alarma fuera de la vista.
    card.classList.add('compacto');

    const boton = document.createElement('button');
    boton.textContent = 'Activar';
    boton.disabled = true;
    portonId = String(dispositivo.id);
    portonBoton = boton;

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
  actualizarConexion();
  setInterval(actualizarConexion, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) actualizarConexion();
  });
}

document.getElementById('logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

init();
