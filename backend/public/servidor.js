// Seccion del servidor NEO: estado actual, graficos de 1 h / 24 h y discos.
// Se carga antes que app.js y usa sus helpers globales (api,
// exigirRespuestaExitosa, liveViews, crearControlAlertasServidor) recien
// cuando app.js llama a crearSeccionServidor.
//
// Graficos en SVG a mano (sin libreria): una serie por grafico salvo los
// nucleos, que comparten unidad (MHz) y por eso eje. Nunca dos escalas en un
// mismo grafico.

const NEO_TZ = 'America/Argentina/Buenos_Aires';
const NEO_OFFSET_MS = -3 * 3600e3; // Argentina no usa horario de verano
const NEO_HUECO_MS = 3 * 60e3; // sin lectura por mas de 3 min: se corta la linea
const NEO_SERIE_1 = '#3987e5'; // slot 1 de la paleta validada (azul)
const NEO_SERIE_2 = '#d95926'; // slot 2 (naranja): par validado para daltonismo
const SVG_NS = 'http://www.w3.org/2000/svg';

const neoHora = new Intl.DateTimeFormat('es-AR', {
  timeZone: NEO_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function svgNodo(tag, atributos = {}) {
  const nodo = document.createElementNS(SVG_NS, tag);
  for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, valor);
  return nodo;
}

const numeroEs = (valor, decimales = 0) =>
  valor.toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

function crearGraficoLinea({ titulo, unidad, series, yMin, yMax, umbrales = [], area = false, decimales = 0 }) {
  const ancho = 320;
  const alto = 132;
  const m = { izq: 36, der: 10, arr: 10, aba: 22 };

  const figura = document.createElement('figure');
  figura.className = 'grafico-neo';
  const cabecera = document.createElement('figcaption');
  const tituloEl = document.createElement('span');
  tituloEl.className = 'grafico-titulo';
  tituloEl.textContent = `${titulo} (${unidad})`;
  cabecera.append(tituloEl);
  if (series.length > 1) {
    const leyenda = document.createElement('span');
    leyenda.className = 'leyenda';
    for (const serie of series) {
      const item = document.createElement('span');
      item.className = 'leyenda-item';
      const clave = document.createElement('i');
      clave.style.background = serie.color;
      item.append(clave, document.createTextNode(serie.nombre));
      leyenda.append(item);
    }
    cabecera.append(leyenda);
  }

  const marco = document.createElement('div');
  marco.className = 'grafico-marco';
  marco.tabIndex = 0;
  const svg = svgNodo('svg', { viewBox: `0 0 ${ancho} ${alto}`, role: 'img' });
  const tip = document.createElement('div');
  tip.className = 'grafico-tip';
  tip.hidden = true;
  marco.append(svg, tip);
  figura.append(cabecera, marco);

  let datos = [];
  let desde = 0;
  let hasta = 1;
  let cruz = null;
  let marcadores = [];

  const x = (t) => m.izq + ((t - desde) / (hasta - desde)) * (ancho - m.izq - m.der);
  const y = (v) => {
    const acotado = Math.min(yMax, Math.max(yMin, v));
    return m.arr + (1 - (acotado - yMin) / (yMax - yMin)) * (alto - m.arr - m.aba);
  };
  const texto = (contenido, atributos) => {
    const nodo = svgNodo('text', atributos);
    nodo.textContent = contenido;
    return nodo;
  };

  // En 24 h hay ~1440 lecturas para ~300 px: se agrupan en tramos de 5 min.
  // Cada serie elige como resumir: la temperatura usa el maximo (un pico no
  // debe desaparecer por promediarlo), el resto el promedio.
  let cubeta = 0;
  function agrupar(lista) {
    const grupos = new Map();
    for (const d of lista) {
      const clave = Math.floor(d.t / cubeta);
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(d);
    }
    return [...grupos.values()].map((grupo) => ({
      t: grupo.at(-1).t,
      inicio: grupo[0].t,
      valores: series.map((serie, i) => {
        const vs = grupo.map((d) => d.valores[i]).filter((v) => typeof v === 'number');
        if (!vs.length) return null;
        return serie.agregado === 'max' ? Math.max(...vs) : vs.reduce((a, b) => a + b, 0) / vs.length;
      }),
    }));
  }

  function render(filas, inicio, fin) {
    desde = inicio;
    hasta = fin;
    cubeta = fin - inicio > 2 * 3600e3 ? 5 * 60e3 : 0;
    datos = filas
      .map((f) => ({ t: Date.parse(f.created_at), valores: series.map((s) => s.valor(f.estado)) }))
      .filter((d) => d.t >= desde && d.valores.some((v) => typeof v === 'number'))
      .sort((a, b) => a.t - b.t);
    if (cubeta) datos = agrupar(datos);
    const hueco = cubeta ? cubeta * 2.5 : NEO_HUECO_MS;
    svg.replaceChildren();

    for (const valor of [yMin, (yMin + yMax) / 2, yMax]) {
      svg.append(svgNodo('line', { x1: m.izq, x2: ancho - m.der, y1: y(valor), y2: y(valor), class: 'grilla' }));
      svg.append(texto(numeroEs(valor), { x: m.izq - 6, y: y(valor) + 3, 'text-anchor': 'end' }));
    }
    for (const umbral of umbrales) {
      svg.append(svgNodo('line', { x1: m.izq, x2: ancho - m.der, y1: y(umbral.valor), y2: y(umbral.valor), class: 'umbral' }));
      svg.append(texto(umbral.etiqueta, { x: ancho - m.der, y: y(umbral.valor) - 4, 'text-anchor': 'end', class: 'umbral-texto' }));
    }

    // Marcas del eje X alineadas a la hora de Argentina: cada 15 min en 1 h, cada 6 h en 24 h.
    const paso = fin - inicio > 2 * 3600e3 ? 6 * 3600e3 : 15 * 60e3;
    for (let t = Math.ceil((inicio + NEO_OFFSET_MS) / paso) * paso - NEO_OFFSET_MS; t <= fin; t += paso) {
      svg.append(texto(neoHora.format(t), { x: x(t), y: alto - 6, 'text-anchor': 'middle' }));
    }

    series.forEach((serie, i) => {
      const tramos = [];
      let actual = [];
      let previo = null;
      for (const d of datos) {
        const valor = d.valores[i];
        if (typeof valor !== 'number' || (previo && d.t - previo > hueco)) {
          if (actual.length) tramos.push(actual);
          actual = [];
        }
        if (typeof valor === 'number') actual.push([x(d.t), y(valor)]);
        previo = d.t;
      }
      if (actual.length) tramos.push(actual);

      for (const tramo of tramos) {
        const puntos = tramo.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
        if (area) {
          const base = y(yMin).toFixed(1);
          svg.append(svgNodo('polygon', {
            points: `${tramo[0][0].toFixed(1)},${base} ${puntos} ${tramo.at(-1)[0].toFixed(1)},${base}`,
            fill: serie.color, class: 'area-neo',
          }));
        }
        if (tramo.length === 1) {
          svg.append(svgNodo('circle', { cx: tramo[0][0], cy: tramo[0][1], r: 2, fill: serie.color }));
        } else {
          svg.append(svgNodo('polyline', { points: puntos, stroke: serie.color, class: 'linea-neo' }));
        }
      }
    });

    // Punto final: la lectura mas reciente, con anillo del color de la superficie.
    const ultimo = datos.at(-1);
    if (ultimo) {
      series.forEach((serie, i) => {
        const v = ultimo.valores[i];
        if (typeof v === 'number') {
          svg.append(svgNodo('circle', { cx: x(ultimo.t), cy: y(v), r: 4, fill: serie.color, class: 'punto-final' }));
        }
      });
    } else {
      svg.append(texto('Sin lecturas en este período', {
        x: (m.izq + ancho - m.der) / 2, y: (m.arr + alto - m.aba) / 2, 'text-anchor': 'middle', class: 'vacio',
      }));
    }

    cruz = svgNodo('line', { y1: m.arr, y2: alto - m.aba, class: 'cruz', visibility: 'hidden' });
    marcadores = series.map((serie) => svgNodo('circle', { r: 4, fill: serie.color, class: 'punto-final', visibility: 'hidden' }));
    svg.append(cruz, ...marcadores);

    const resumen = ultimo
      ? series.map((s, i) => (typeof ultimo.valores[i] === 'number' ? `${s.nombre} ${numeroEs(ultimo.valores[i], decimales)} ${unidad}` : null)).filter(Boolean).join(', ')
      : 'sin lecturas';
    svg.setAttribute('aria-label', `${titulo}, última lectura: ${resumen}. Usá las flechas para recorrer los valores.`);
    if (!tip.hidden) ocultar();
  }

  function mostrar(indice) {
    const d = datos[indice];
    if (!d || !cruz) return;
    const px = x(d.t);
    cruz.setAttribute('x1', px);
    cruz.setAttribute('x2', px);
    cruz.setAttribute('visibility', 'visible');
    marcadores.forEach((marcador, i) => {
      const v = d.valores[i];
      marcador.setAttribute('visibility', typeof v === 'number' ? 'visible' : 'hidden');
      if (typeof v === 'number') {
        marcador.setAttribute('cx', px);
        marcador.setAttribute('cy', y(v));
      }
    });

    const hora = document.createElement('div');
    hora.className = 'tip-hora';
    hora.textContent = cubeta
      ? `${neoHora.format(d.inicio)}–${neoHora.format(d.t)} · ${series.some((s) => s.agregado === 'max') ? 'máximo' : 'promedio'}`
      : neoHora.format(d.t);
    const filas = series.map((serie, i) => {
      const fila = document.createElement('div');
      fila.className = 'tip-fila';
      const clave = document.createElement('i');
      clave.style.background = serie.color;
      const valor = document.createElement('strong');
      valor.textContent = typeof d.valores[i] === 'number' ? `${numeroEs(d.valores[i], decimales)} ${unidad}` : '–';
      const nombre = document.createElement('span');
      nombre.textContent = serie.nombre;
      fila.append(clave, valor, nombre);
      return fila;
    });
    tip.replaceChildren(hora, ...filas);
    tip.hidden = false;
    // El tooltip se ubica del lado contrario al cursor para no taparlo.
    const fraccion = px / ancho;
    tip.style.left = fraccion > 0.55 ? 'auto' : `calc(${(fraccion * 100).toFixed(1)}% + 10px)`;
    tip.style.right = fraccion > 0.55 ? `calc(${((1 - fraccion) * 100).toFixed(1)}% + 10px)` : 'auto';
    marco.dataset.indice = indice;
  }

  function ocultar() {
    tip.hidden = true;
    cruz?.setAttribute('visibility', 'hidden');
    marcadores.forEach((marcador) => marcador.setAttribute('visibility', 'hidden'));
    delete marco.dataset.indice;
  }

  marco.addEventListener('pointermove', (evento) => {
    if (!datos.length) return;
    const caja = svg.getBoundingClientRect();
    const t = desde + (((evento.clientX - caja.left) / caja.width) * ancho - m.izq) / (ancho - m.izq - m.der) * (hasta - desde);
    let cercano = 0;
    for (let i = 1; i < datos.length; i += 1) {
      if (Math.abs(datos[i].t - t) < Math.abs(datos[cercano].t - t)) cercano = i;
    }
    mostrar(cercano);
  });
  marco.addEventListener('pointerleave', ocultar);
  marco.addEventListener('blur', ocultar);
  marco.addEventListener('focus', () => mostrar(datos.length - 1));
  marco.addEventListener('keydown', (evento) => {
    const actual = Number(marco.dataset.indice ?? datos.length - 1);
    const destino = { ArrowLeft: actual - 1, ArrowRight: actual + 1, Home: 0, End: datos.length - 1 }[evento.key];
    if (destino === undefined) return;
    evento.preventDefault();
    mostrar(Math.max(0, Math.min(datos.length - 1, destino)));
  });

  return { el: figura, render };
}

function crearValorNeo(etiqueta) {
  const caja = document.createElement('div');
  caja.className = 'valor-neo';
  const valor = document.createElement('div');
  valor.className = 'valor-neo-numero';
  valor.textContent = '–';
  const rotulo = document.createElement('div');
  rotulo.className = 'valor-neo-rotulo';
  rotulo.textContent = etiqueta;
  // Mismo orden que las fichas del disyuntor: titulo arriba, dato abajo.
  caja.append(rotulo, valor);
  return { el: caja, valor, rotulo };
}

// Carga en % de la capacidad total (2 nucleos = 100 %), con una barra partida
// en dos mitades que se llena primero una y despues la otra. Es una
// simplificacion visual: la carga de Linux no se reparte por nucleo, pero
// deja a la vista que la capacidad es la suma de los dos.
const NEO_NUCLEOS = 2;

function crearValorCarga() {
  const base = crearValorNeo('Carga del CPU');
  base.el.title = 'Procesos usando o esperando el CPU (promedio del último minuto), sobre la capacidad de los 2 núcleos. Más de 100 % = tareas haciendo fila.';
  const barra = document.createElement('div');
  barra.className = 'carga-barra';
  barra.setAttribute('role', 'meter');
  barra.setAttribute('aria-label', 'Carga del CPU');
  barra.setAttribute('aria-valuemin', '0');
  barra.setAttribute('aria-valuemax', '100');
  const rellenos = [];
  const velocidades = [];
  // Cada mitad lleva su nucleo y su velocidad: reemplaza a las fichas sueltas
  // de "Nucleo 1/2", que repetian los mismos nombres.
  for (let i = 1; i <= NEO_NUCLEOS; i += 1) {
    const mitad = document.createElement('div');
    mitad.className = 'carga-mitad';
    const pista = document.createElement('div');
    pista.className = 'carga-pista';
    const relleno = document.createElement('div');
    relleno.className = 'carga-relleno';
    pista.append(relleno);
    const nombre = document.createElement('span');
    nombre.textContent = `Núcleo ${i}`;
    const velocidad = document.createElement('span');
    velocidad.className = 'carga-mhz';
    velocidad.textContent = '–';
    mitad.append(pista, nombre, velocidad);
    barra.append(mitad);
    rellenos.push(relleno);
    velocidades.push(velocidad);
  }
  base.el.append(barra);

  return {
    el: base.el,
    set(load1, nucleosMhz) {
      velocidades.forEach((el, i) => {
        const mhz = nucleosMhz?.[i];
        el.textContent = typeof mhz === 'number' ? `${numeroEs(mhz)} MHz` : '–';
      });
      if (typeof load1 !== 'number') {
        base.valor.textContent = '–';
        rellenos.forEach((r) => { r.style.transform = 'scaleX(0)'; });
        return;
      }
      const porcentaje = Math.round((load1 / NEO_NUCLEOS) * 100);
      base.valor.textContent = `${porcentaje} %`;
      barra.setAttribute('aria-valuenow', String(Math.min(100, porcentaje)));
      rellenos.forEach((relleno, i) => {
        const fraccion = Math.min(1, Math.max(0, load1 - i));
        relleno.style.transform = `scaleX(${fraccion})`;
        relleno.dataset.nivel = porcentaje > 100 ? 'critico' : porcentaje >= 80 ? 'atencion' : '';
      });
    },
  };
}

const ICONO_ALERTA = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1L8 1.8Z"/><path d="M8 6.2v3.6M8 11.6v.2"/></svg>';

// Estado de temperatura: icono + texto, nunca solo color (umbral del sensor 70 °C, alerta 85 °C).
function estadoTemperatura(celsius) {
  if (celsius >= 85) return { clase: 'critico', texto: 'Alerta' };
  if (celsius >= 70) return { clase: 'atencion', texto: 'Alta' };
  return null;
}

function crearMedidorDisco(etiqueta) {
  const caja = document.createElement('div');
  caja.className = 'medidor';
  const fila = document.createElement('div');
  fila.className = 'medidor-fila';
  const nombre = document.createElement('span');
  nombre.textContent = etiqueta;
  const valor = document.createElement('strong');
  valor.textContent = '–';
  fila.append(nombre, valor);
  const pista = document.createElement('div');
  pista.className = 'medidor-pista';
  pista.setAttribute('role', 'meter');
  pista.setAttribute('aria-label', etiqueta);
  pista.setAttribute('aria-valuemin', '0');
  pista.setAttribute('aria-valuemax', '100');
  const relleno = document.createElement('div');
  relleno.className = 'medidor-relleno';
  pista.append(relleno);
  caja.append(fila, pista);

  return {
    el: caja,
    set(porcentaje) {
      const ok = typeof porcentaje === 'number';
      valor.textContent = ok ? `${porcentaje} % usado` : 'sin datos';
      relleno.style.transform = `scaleX(${ok ? Math.min(100, porcentaje) / 100 : 0})`;
      relleno.dataset.nivel = !ok ? '' : porcentaje >= 90 ? 'critico' : porcentaje >= 80 ? 'atencion' : '';
      if (ok) pista.setAttribute('aria-valuenow', String(porcentaje));
    },
  };
}

function crearSeccionServidor(dispositivo, card, nombre) {
  let horas = 1;
  let filas = [];

  // Cabecera: nombre, ultima lectura y el filtro de periodo, que afecta a todo lo de abajo.
  const cabecera = document.createElement('div');
  cabecera.className = 'neo-cabecera';
  const identidad = document.createElement('div');
  identidad.className = 'neo-identidad';
  const lecturaEl = document.createElement('div');
  lecturaEl.className = 'historial';
  identidad.append(lecturaEl);

  // Todo NEO va en un desplegable cerrado por defecto. Cerrado muestra una
  // linea de resumen y, si la temperatura esta alta, el aviso: lo importante
  // no queda escondido.
  const desplegable = document.createElement('details');
  desplegable.className = 'neo-desplegable';
  const resumen = document.createElement('summary');
  const resumenTexto = document.createElement('span');
  resumenTexto.className = 'neo-resumen';
  resumenTexto.textContent = 'Cargando...';
  const resumenChip = document.createElement('span');
  resumenChip.className = 'estado-chip';
  resumenChip.hidden = true;
  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.setAttribute('aria-hidden', 'true');
  const resumenTitulo = document.createElement('span');
  resumenTitulo.className = 'neo-resumen-titulo';
  resumenTitulo.append(nombre, resumenChip);
  resumen.append(resumenTitulo, resumenTexto, chevron);
  const contenido = document.createElement('div');
  contenido.className = 'neo-contenido';

  const periodo = document.createElement('div');
  periodo.className = 'segmentado';
  periodo.setAttribute('role', 'group');
  periodo.setAttribute('aria-label', 'Período de los gráficos');
  const botonesPeriodo = [1, 24].map((h) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = `${h} h`;
    boton.setAttribute('aria-pressed', String(h === horas));
    boton.addEventListener('click', () => {
      if (h === horas) return;
      horas = h;
      botonesPeriodo.forEach((b, i) => b.setAttribute('aria-pressed', String([1, 24][i] === horas)));
      cargar();
    });
    periodo.append(boton);
    return boton;
  });
  cabecera.append(identidad, periodo);

  const valores = document.createElement('div');
  valores.className = 'neo-valores';
  const temperatura = crearValorNeo('Temperatura CPU');
  const estadoTemp = document.createElement('span');
  estadoTemp.className = 'estado-chip';
  estadoTemp.hidden = true;
  temperatura.rotulo.append(estadoTemp);
  const ram = crearValorNeo('RAM');
  const carga = crearValorCarga();
  const bateria = crearValorNeo('Batería');
  valores.append(temperatura.el, ram.el, carga.el, bateria.el);

  const graficos = document.createElement('div');
  graficos.className = 'neo-graficos';
  const graficoTemp = crearGraficoLinea({
    titulo: 'Temperatura CPU', unidad: '°C', yMin: 30, yMax: 100, decimales: 1,
    series: [{ nombre: 'CPU', color: NEO_SERIE_1, valor: (e) => e?.cpu_c, agregado: 'max' }],
    umbrales: [{ valor: 70, etiqueta: 'Alta 70' }, { valor: 85, etiqueta: 'Alerta 85' }],
  });
  const graficoRam = crearGraficoLinea({
    titulo: 'RAM usada', unidad: '%', yMin: 0, yMax: 100, area: true,
    series: [{ nombre: 'RAM', color: NEO_SERIE_1, valor: (e) => e?.ram_pct }],
  });
  const graficoNucleos = crearGraficoLinea({
    titulo: 'Velocidad de núcleos', unidad: 'MHz', yMin: 0, yMax: 3000,
    series: [
      { nombre: 'Núcleo 1', color: NEO_SERIE_1, valor: (e) => e?.nucleos_mhz?.[0] },
      { nombre: 'Núcleo 2', color: NEO_SERIE_2, valor: (e) => e?.nucleos_mhz?.[1] },
    ],
    umbrales: [{ valor: 1900, etiqueta: 'Límite 1900' }],
  });
  graficos.append(graficoTemp.el, graficoRam.el, graficoNucleos.el);

  const pie = document.createElement('div');
  pie.className = 'neo-pie';
  const discos = document.createElement('div');
  discos.className = 'neo-discos';
  const ssd = crearMedidorDisco('SSD (sistema)');
  const hdd = crearMedidorDisco('HDD (backups)');
  discos.append(ssd.el, hdd.el);
  pie.append(discos, crearControlAlertasServidor());

  // Tabla equivalente a los graficos: se arma solo al abrirla.
  const tabla = document.createElement('details');
  tabla.className = 'tabla-datos';
  const resumenTabla = document.createElement('summary');
  resumenTabla.textContent = 'Ver datos en tabla';
  const contenedorTabla = document.createElement('div');
  contenedorTabla.className = 'tabla-scroll';
  tabla.append(resumenTabla, contenedorTabla);
  tabla.addEventListener('toggle', () => { if (tabla.open) dibujarTabla(); });

  contenido.append(cabecera, valores, graficos, pie, tabla);
  desplegable.append(resumen, contenido);
  card.append(desplegable);

  // El historial se pide recien la primera vez que se abre.
  let cargado = false;
  desplegable.addEventListener('toggle', () => {
    if (!desplegable.open) return;
    if (cargado) dibujarGraficos();
    else { cargado = true; cargar(); }
  });

  function dibujarTabla() {
    const paso = horas === 24 ? 10 : 1; // 24 h: una fila cada 10 lecturas
    const elegidas = [...filas].sort((a, b) => b.created_at.localeCompare(a.created_at)).filter((_, i) => i % paso === 0);
    const t = document.createElement('table');
    const cabeza = t.createTHead().insertRow();
    for (const titulo of ['Hora', 'CPU °C', 'RAM %', 'Núcleo 1 MHz', 'Núcleo 2 MHz', 'Carga %']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = titulo;
      cabeza.append(th);
    }
    const cuerpo = t.createTBody();
    for (const f of elegidas) {
      const fila = cuerpo.insertRow();
      const e = f.estado ?? {};
      for (const v of [neoHora.format(Date.parse(f.created_at)), e.cpu_c, e.ram_pct, e.nucleos_mhz?.[0], e.nucleos_mhz?.[1], typeof e.load1 === 'number' ? Math.round((e.load1 / NEO_NUCLEOS) * 100) : null]) {
        fila.insertCell().textContent = v ?? '–';
      }
    }
    contenedorTabla.replaceChildren(t);
  }

  function mostrarActual(estado, at) {
    if (!estado) {
      lecturaEl.textContent = 'Sin lecturas todavía';
      resumenTexto.textContent = 'Sin lecturas todavía';
      return;
    }
    const hora = neoHora.format(Date.parse(at));
    lecturaEl.textContent = `Última lectura ${hora}`;
    const partes = [];
    if (typeof estado.cpu_c === 'number') partes.push(`${numeroEs(estado.cpu_c, 1)} °C`);
    if (typeof estado.ram_pct === 'number') partes.push(`RAM ${estado.ram_pct} %`);
    partes.push(hora);
    resumenTexto.textContent = partes.join(' · ');
    temperatura.valor.textContent = typeof estado.cpu_c === 'number' ? `${numeroEs(estado.cpu_c, 1)} °C` : '–';
    const alerta = typeof estado.cpu_c === 'number' ? estadoTemperatura(estado.cpu_c) : null;
    for (const chip of [estadoTemp, resumenChip]) {
      chip.hidden = !alerta;
      if (alerta) {
        chip.className = `estado-chip ${alerta.clase}`;
        chip.innerHTML = ICONO_ALERTA;
        chip.append(document.createTextNode(alerta.texto));
      }
    }
    ram.valor.textContent = typeof estado.ram_pct === 'number' ? `${estado.ram_pct} %` : '–';
    carga.set(estado.load1, estado.nucleos_mhz);
    bateria.valor.textContent = typeof estado.bateria_pct === 'number' ? `${estado.bateria_pct} %` : '–';
    bateria.rotulo.textContent = estado.enchufado === false ? 'Batería · desenchufado' : 'Batería · enchufado';
    ssd.set(estado.disco_ssd_pct);
    hdd.set(estado.disco_hdd_pct);
  }

  function dibujarGraficos() {
    const fin = Date.now();
    const inicio = fin - horas * 3600e3;
    filas = filas.filter((f) => Date.parse(f.created_at) >= inicio);
    for (const grafico of [graficoTemp, graficoRam, graficoNucleos]) grafico.render(filas, inicio, fin);
    if (tabla.open) dibujarTabla();
  }

  async function cargar() {
    // Al recargar se conserva el grafico anterior atenuado: sin parpadeo ni salto.
    graficos.classList.add('cargando');
    try {
      filas = await exigirRespuestaExitosa(await api(`/api/dispositivos/${dispositivo.id}/estados?horas=${horas}`));
      dibujarGraficos();
    } catch (error) {
      lecturaEl.textContent = error.message;
    } finally {
      graficos.classList.remove('cargando');
    }
  }

  liveViews.set(String(dispositivo.id), (update) => {
    mostrarActual(update.estado, update.estado_actualizado_at);
    if (!cargado) return;
    filas.push({ estado: update.estado, created_at: update.estado_actualizado_at });
    if (desplegable.open) dibujarGraficos();
  });
  leerEstado(dispositivo.id).then(({ estado, estado_actualizado_at }) => mostrarActual(estado, estado_actualizado_at));
  // Mueve la ventana aunque no lleguen lecturas (si NEO se apaga, el hueco se ve).
  setInterval(() => { if (desplegable.open && !document.hidden) dibujarGraficos(); }, 60000);
}
