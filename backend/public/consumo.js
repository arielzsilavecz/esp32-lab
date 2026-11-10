// Vista mensual del disyuntor: una barra por dia con su consumo (kWh). Tocar
// un dia muestra su total en numeros. Usa helpers globales de app.js y
// servidor.js (api, exigirRespuestaExitosa, numeroEs, crearValorNeo, TZ_AR)
// recien cuando se crea la vista.
//
// Barras como botones HTML (no SVG): cada dia es tocable y enfocable con el
// teclado sin codigo extra de accesibilidad.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
// El historial se borra a los 60 dias (ADR-0009): no se ofrecen meses sin datos.
const DIAS_HISTORIAL = 60;

const mesDe = (fechaIso) => fechaIso.slice(0, 7);
const sumarMes = (mes, delta) => {
  const [anio, numero] = mes.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, numero - 1 + delta, 1));
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`;
};
const diasDelMes = (mes) => {
  const [anio, numero] = mes.split('-').map(Number);
  return new Date(Date.UTC(anio, numero, 0)).getUTCDate();
};
const nombreMes = (mes) => {
  const [anio, numero] = mes.split('-').map(Number);
  return `${MESES[numero - 1][0].toUpperCase()}${MESES[numero - 1].slice(1)} ${anio}`;
};
const fechaLarga = (fechaIso) => new Date(`${fechaIso}T12:00:00Z`).toLocaleDateString('es-AR', {
  timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
});

function crearVistaMensual(dispositivo) {
  const hoy = fechaAR();
  const mesActual = mesDe(hoy);
  const mesMinimo = mesDe(fechaAR(new Date(Date.now() - DIAS_HISTORIAL * 86400e3)));
  let mes = mesActual;
  let dias = new Map();
  let elegido = null;

  const vista = document.createElement('div');
  vista.className = 'vista-mensual';

  const navegacion = document.createElement('div');
  navegacion.className = 'mes-navegacion';
  const anterior = document.createElement('button');
  anterior.type = 'button';
  anterior.className = 'boton-icono boton-mes';
  anterior.setAttribute('aria-label', 'Mes anterior');
  anterior.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
  const siguiente = document.createElement('button');
  siguiente.type = 'button';
  siguiente.className = 'boton-icono boton-mes';
  siguiente.setAttribute('aria-label', 'Mes siguiente');
  siguiente.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  const titulo = document.createElement('div');
  titulo.className = 'mes-titulo';
  const nombre = document.createElement('strong');
  const total = document.createElement('span');
  titulo.append(nombre, total);
  navegacion.append(anterior, titulo, siguiente);

  const grafico = document.createElement('div');
  grafico.className = 'barras-mes';
  const escala = document.createElement('div');
  escala.className = 'barras-escala';
  const barras = document.createElement('div');
  barras.className = 'barras';
  barras.setAttribute('role', 'group');
  const ejeX = document.createElement('div');
  ejeX.className = 'barras-eje';
  grafico.append(escala, barras, ejeX);

  // Total del dia elegido, en numeros.
  const detalle = document.createElement('div');
  detalle.className = 'detalle-dia';
  detalle.setAttribute('aria-live', 'polite');
  const detalleFecha = document.createElement('div');
  detalleFecha.className = 'detalle-dia-fecha';
  const detalleValores = document.createElement('div');
  detalleValores.className = 'detalle-dia-valores';
  const consumoDia = crearValorNeo('Consumo del día');
  const potenciaDia = crearValorNeo('Potencia máxima');
  detalleValores.append(consumoDia.el, potenciaDia.el);
  detalle.append(detalleFecha, detalleValores);

  vista.append(navegacion, grafico, detalle);

  function elegir(fecha) {
    elegido = fecha;
    for (const boton of barras.children) boton.setAttribute('aria-pressed', String(boton.dataset.fecha === fecha));
    const dato = dias.get(fecha);
    detalleFecha.textContent = fechaLarga(fecha) + (fecha === hoy ? ' (hoy, en curso)' : '');
    consumoDia.valor.textContent = dato ? `${numeroEs(dato.kwh, 2)} kWh` : 'Sin datos';
    potenciaDia.valor.textContent = typeof dato?.potencia_max_w === 'number' ? `${numeroEs(dato.potencia_max_w)} W` : '–';
  }

  function dibujar() {
    const cantidad = diasDelMes(mes);
    const maximo = Math.max(0.1, ...[...dias.values()].map((d) => d.kwh));
    const totalMes = [...dias.values()].reduce((suma, d) => suma + d.kwh, 0);
    nombre.textContent = nombreMes(mes);
    total.textContent = dias.size ? `Total ${numeroEs(totalMes, 2)} kWh` : 'Sin datos este mes';
    anterior.disabled = mes <= mesMinimo;
    siguiente.disabled = mes >= mesActual;

    escala.replaceChildren(...[maximo, maximo / 2].map((valor) => {
      const linea = document.createElement('span');
      linea.style.bottom = `${(valor / maximo) * 100}%`;
      linea.textContent = `${numeroEs(valor, valor < 10 ? 1 : 0)} kWh`;
      return linea;
    }));

    barras.style.setProperty('--dias', cantidad);
    barras.setAttribute('aria-label', `Consumo por día de ${nombreMes(mes)}`);
    barras.replaceChildren();
    ejeX.replaceChildren();
    ejeX.style.setProperty('--dias', cantidad);
    for (let dia = 1; dia <= cantidad; dia += 1) {
      const fecha = `${mes}-${String(dia).padStart(2, '0')}`;
      const dato = dias.get(fecha);
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'barra-dia';
      boton.dataset.fecha = fecha;
      boton.disabled = fecha > hoy;
      const texto = dato ? `${numeroEs(dato.kwh, 2)} kWh` : 'sin datos';
      boton.setAttribute('aria-label', `${dia}: ${texto}`);
      boton.title = `${dia} · ${texto}`;
      const barra = document.createElement('span');
      barra.style.height = dato ? `${Math.max(2, (dato.kwh / maximo) * 100)}%` : '0';
      if (fecha === hoy) boton.dataset.hoy = 'true';
      boton.append(barra);
      boton.addEventListener('click', () => elegir(fecha));
      barras.append(boton);

      const etiqueta = document.createElement('span');
      // Marcas cada 7 dias mas el ultimo; una marca semanal pegada al ultimo dia
      // se omite para que no se encimen ("29" y "30").
      if (dia === 1 || dia === cantidad || (dia % 7 === 1 && cantidad - dia >= 3)) etiqueta.textContent = String(dia);
      ejeX.append(etiqueta);
    }

    const ultimoConDatos = [...dias.keys()].at(-1);
    elegir(elegido && mesDe(elegido) === mes ? elegido : mes === mesActual ? hoy : ultimoConDatos ?? `${mes}-01`);
  }

  async function cargar() {
    grafico.classList.add('cargando');
    try {
      const filas = await exigirRespuestaExitosa(await api(`/api/dispositivos/${dispositivo.id}/consumo?mes=${mes}`));
      dias = new Map(filas.map((f) => [f.dia, f]));
      dibujar();
    } catch (error) {
      total.textContent = error.message;
    } finally {
      grafico.classList.remove('cargando');
    }
  }

  anterior.addEventListener('click', () => { mes = sumarMes(mes, -1); cargar(); });
  siguiente.addEventListener('click', () => { mes = sumarMes(mes, 1); cargar(); });

  return { el: vista, cargar };
}
