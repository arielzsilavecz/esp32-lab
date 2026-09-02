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

    const boton = document.createElement('button');
    boton.textContent = 'Activar';

    const historialEl = document.createElement('div');
    historialEl.className = 'historial';

    boton.addEventListener('click', () => activar(dispositivo.id, boton, historialEl));

    card.append(nombre, tipo, boton, historialEl);
    listEl.appendChild(card);

    cargarHistorial(dispositivo.id, historialEl);
  }
}

document.getElementById('logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

init();
