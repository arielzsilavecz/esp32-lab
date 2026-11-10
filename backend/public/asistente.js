// Orden escrita para las luces ("living al 30 % cálido"). La interpreta NEO en
// local: reglas para lo simple, el modelo 2B para el resto (ADR-0014). La
// respuesta vuelve como estado del dispositivo "asistente" por el canal en vivo.
// Usa helpers globales de app.js (enviarComando, liveViews).

const ASISTENTE_LIMITE_MS = 120_000;

function crearAsistente(dispositivo, contenedor) {
  const form = document.createElement('form');
  form.className = 'asistente';
  const campo = document.createElement('input');
  campo.type = 'text';
  campo.maxLength = 200;
  campo.placeholder = 'Ej.: living al 30 % cálido';
  campo.setAttribute('aria-label', 'Orden para las luces');
  campo.enterKeyHint = 'send';
  const boton = document.createElement('button');
  boton.type = 'submit';
  boton.textContent = 'Enviar';
  form.append(campo, boton);

  const respuesta = document.createElement('div');
  respuesta.className = 'asistente-respuesta';
  respuesta.setAttribute('role', 'status');
  respuesta.hidden = true;

  let pendiente = null;
  let limite = null;

  function terminar(texto) {
    pendiente = null;
    clearTimeout(limite);
    campo.disabled = boton.disabled = false;
    respuesta.textContent = texto;
  }

  // Con reglas, NEO puede responder antes de que vuelva el POST: se guarda el
  // ultimo estado para revisarlo apenas se conoce el id de la orden.
  let ultimo = null;
  function mostrar(estado) {
    ultimo = estado;
    if (!pendiente || estado?.orden !== pendiente) return;
    if (estado.pensando) {
      respuesta.textContent = 'Interpretando con el modelo local, puede tardar hasta un minuto…';
      return;
    }
    terminar(estado.respuesta ?? 'Listo.');
  }
  liveViews.set(String(dispositivo.id), ({ estado }) => mostrar(estado));

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const texto = campo.value.trim();
    if (!texto || pendiente) return;
    campo.disabled = boton.disabled = true;
    respuesta.hidden = false;
    respuesta.textContent = 'Enviando…';
    try {
      const { id } = await enviarComando(dispositivo.id, 'interpretar', { texto });
      pendiente = id;
      campo.value = '';
      respuesta.textContent = 'NEO recibió la orden…';
      limite = setTimeout(() => terminar('NEO no respondió. Probá de nuevo.'), ASISTENTE_LIMITE_MS);
      mostrar(ultimo);
    } catch (error) {
      terminar(error.message);
    }
  });

  contenedor.querySelector('.grupo-titulo').after(form, respuesta);
}
