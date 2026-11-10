// Tarjeta de camara: en reposo es una linea (nombre + "Ver en vivo") y no pide
// nada. Al tocar el boton se despliega el recuadro: manda la orden "ver" (NEO
// transmite 2 min) y consulta el ultimo cuadro cada medio segundo. Se cierra
// con "Detener", al ocultar la pagina o a los 2 min si no se toca "Seguir
// mirando". Las flechas giran la camara (orden "mover"). Ver ADR-0012.
// Usa helpers globales de app.js (api, enviarComando, horaExactaAR).

const CAMARA_VER_MS = 120_000; // igual a VER_SEGUNDOS del puente
const CAMARA_CONSULTA_MS = 500;
const CAMARA_SIN_IMAGEN_MS = 15_000;
// Pausa entre giros: el puente hace pulsos de 0,4 s; mas rapido se encolan.
const CAMARA_GIRO_PAUSA_MS = 700;

const FLECHAS = [
  ['arriba', 'Girar arriba', 'M6 15l6-6 6 6'],
  ['izquierda', 'Girar a la izquierda', 'M15 6l-6 6 6 6'],
  ['derecha', 'Girar a la derecha', 'M9 6l6 6-6 6'],
  ['abajo', 'Girar abajo', 'M6 9l6 6 6-6'],
];

function formatoRestante(ms) {
  const segundos = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;
}

function crearTarjetaCamara(dispositivo, card, nombre) {
  let activa = false;
  let hasta = 0;
  let inicio = 0;
  let ultima = 0;
  let consulta = null;
  let urlImagen = null;

  // Linea de reposo, igual que el porton.
  card.classList.add('compacto');
  const fila = document.createElement('div');
  fila.className = 'fila-compacta';
  const botonVer = document.createElement('button');
  botonVer.type = 'button';
  botonVer.textContent = 'Ver en vivo';
  fila.append(nombre, botonVer);
  const aviso = document.createElement('div');
  aviso.className = 'historial';
  aviso.hidden = true;

  // Recuadro desplegable.
  const panel = document.createElement('div');
  panel.className = 'camara-panel';
  panel.hidden = true;
  const marco = document.createElement('div');
  marco.className = 'camara-marco';
  const imagen = document.createElement('img');
  imagen.alt = `Imagen en vivo de ${dispositivo.nombre}`;
  imagen.hidden = true;
  const conectando = document.createElement('div');
  conectando.className = 'camara-conectando';
  conectando.textContent = 'Conectando con la cámara...';
  marco.append(imagen, conectando);

  const estado = document.createElement('div');
  estado.className = 'camara-estado';
  estado.setAttribute('role', 'status');

  const controles = document.createElement('div');
  controles.className = 'camara-controles';
  const pad = document.createElement('div');
  pad.className = 'camara-pad';
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', 'Girar la cámara');
  const flechas = FLECHAS.map(([direccion, etiqueta, trazo]) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = `boton-icono flecha flecha-${direccion}`;
    boton.setAttribute('aria-label', etiqueta);
    boton.title = etiqueta;
    boton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${trazo}"/></svg>`;
    boton.addEventListener('click', () => girar(direccion));
    pad.append(boton);
    return boton;
  });
  const acciones = document.createElement('div');
  acciones.className = 'camara-acciones';
  const botonSeguir = document.createElement('button');
  botonSeguir.type = 'button';
  botonSeguir.textContent = 'Seguir mirando';
  const botonDetener = document.createElement('button');
  botonDetener.type = 'button';
  botonDetener.textContent = 'Detener';
  acciones.append(botonSeguir, botonDetener);
  controles.append(pad, acciones);

  panel.append(marco, estado, controles);
  card.append(fila, aviso, panel);

  function plegar(mensaje) {
    panel.hidden = true;
    imagen.hidden = true;
    conectando.hidden = false;
    botonVer.hidden = false;
    botonVer.disabled = false;
    aviso.hidden = !mensaje;
    aviso.textContent = mensaje ?? '';
    if (urlImagen) {
      URL.revokeObjectURL(urlImagen);
      urlImagen = null;
    }
  }

  function detener(mensaje) {
    if (!activa) return;
    activa = false;
    clearTimeout(consulta);
    // keepalive: la orden sale aunque la pagina se este cerrando.
    fetch(`/api/dispositivos/${dispositivo.id}/comandos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo_comando: 'detener' }),
      keepalive: true,
    }).catch(() => {});
    plegar(mensaje);
  }

  async function girar(direccion) {
    flechas.forEach((f) => { f.disabled = true; });
    try {
      await enviarComando(dispositivo.id, 'mover', { direccion });
    } catch (error) {
      estado.textContent = error.message;
    } finally {
      setTimeout(() => flechas.forEach((f) => { f.disabled = false; }), CAMARA_GIRO_PAUSA_MS);
    }
  }

  async function consultar() {
    if (!activa) return;
    if (Date.now() >= hasta) {
      detener('Se cortó a los 2 minutos.');
      return;
    }
    try {
      const respuesta = await api(`/api/dispositivos/${dispositivo.id}/imagen?despues=${ultima}`, { cache: 'no-store' });
      if (!activa) return;
      if (respuesta.status === 200) {
        ultima = Number(respuesta.headers.get('X-Capturada')) || Date.now();
        const nueva = URL.createObjectURL(await respuesta.blob());
        imagen.src = nueva;
        if (urlImagen) URL.revokeObjectURL(urlImagen);
        urlImagen = nueva;
        imagen.hidden = false;
        conectando.hidden = true;
      }
    } catch {
      // un fallo puntual de red no corta la vista; el control de abajo si
    }
    if (Date.now() - (ultima || inicio) > CAMARA_SIN_IMAGEN_MS) {
      detener(ultima ? 'La cámara dejó de responder.' : 'La cámara no respondió. Probá de nuevo en un rato.');
      return;
    }
    estado.replaceChildren();
    const punto = document.createElement('span');
    punto.className = ultima ? 'punto-vivo' : 'punto-conectando';
    punto.setAttribute('aria-hidden', 'true');
    estado.append(punto, document.createTextNode(ultima
      ? `En vivo · ${horaExactaAR(new Date(ultima).toISOString())} · se corta en ${formatoRestante(hasta - Date.now())}`
      : 'Conectando...'));
    consulta = setTimeout(consultar, CAMARA_CONSULTA_MS);
  }

  botonVer.addEventListener('click', async () => {
    botonVer.disabled = true;
    aviso.hidden = true;
    try {
      await enviarComando(dispositivo.id, 'ver');
    } catch (error) {
      plegar(error.message);
      return;
    }
    activa = true;
    inicio = Date.now();
    ultima = 0;
    hasta = inicio + CAMARA_VER_MS;
    botonVer.hidden = true;
    panel.hidden = false;
    consultar();
  });

  botonSeguir.addEventListener('click', async () => {
    botonSeguir.disabled = true;
    try {
      await enviarComando(dispositivo.id, 'ver');
      hasta = Date.now() + CAMARA_VER_MS;
    } catch (error) {
      estado.textContent = error.message;
    } finally {
      botonSeguir.disabled = false;
    }
  });

  botonDetener.addEventListener('click', () => detener());
  // Cambiar de app, de pestana o cerrar: no se sigue transmitiendo a nadie.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) detener('Se detuvo al salir de la página.');
  });
}
