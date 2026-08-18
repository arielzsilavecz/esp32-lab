# ADR-0004: Analizador de protocolos en Python, fuera de `firmware/`

## Estado

Aceptado

## Fecha

2026-08-12

## Contexto

La Etapa 4 pide detectar automáticamente ancho de pulso, sincronismo, repetición y
bits posibles a partir de una captura ya exportada (CSV, Etapa 3), sin asumir ningún
protocolo. A diferencia de la captura (Etapa 3), que tiene que correr en tiempo real
sobre el ESP32 por la interrupción, el análisis es procesamiento de datos puro sobre un
archivo ya guardado — no hay restricción de hardware ni de tiempo real. Hace falta
decidir en qué lenguaje/entorno vive esta herramienta.

## Decisión

Script de Python (`tools/analyze_capture.py`), usando **solo librería estándar**
(`csv`, `statistics`, `argparse`, `dataclasses`) — cero dependencias externas que
instalar. Lee un CSV de `docs/captures/`, imprime un reporte de texto (clusters de
ancho de pulso por nivel, tramas detectadas, comparación de tramas por símbolo).

Algoritmos deliberadamente simples y auditables a mano, sin librerías de ML:

- **Clustering de anchos de pulso**: ordenar y cortar donde el salto relativo entre
  valores consecutivos supera un umbral (`--cluster-ratio`, default 1.3). No k-means.
- **Detección de huecos de trama**: un hueco es borde de trama si supera
  `--gap-ratio` (default 5) veces la mediana de todas las duraciones. La mediana es
  robusta porque los huecos son minoría.
- **Comparación de tramas**: por *símbolo* (a qué cluster pertenece cada pulso), no
  por duración cruda — ver más abajo por qué.

## Alternativas consideradas

- **`env:native` de PlatformIO (C++ compilado para PC)** — se queda en un solo
  lenguaje/toolchain (ya instalado para el firmware). Rechazada para esta etapa: el
  análisis es exploratorio por naturaleza (ajustar umbrales, mirar resultados, iterar),
  y parsing de CSV + estructuras dinámicas es bastante más verboso en C++ sin ninguna
  ventaja real acá (no hay restricción de hardware que lo justifique). Si más adelante
  hiciera falta correr esta lógica *en* el ESP32 (no está en el roadmap actual), se
  puede portar entonces.
- **Análisis dentro del firmware, impreso por Serial** — descartada por iteración
  lenta (compilar+flashear+leer serial en cada ajuste de umbral) y por mezclar una
  responsabilidad de procesamiento de datos con el firmware de captura en tiempo real.
- **Numpy/matplotlib para clustering/visualización** — se dejan afuera de este primer
  corte: agregan una dependencia externa (instalación con pip) para un problema que un
  clustering simple de ~15 líneas ya resuelve. Si hace falta visualizar histogramas más
  adelante, se evalúa entonces como adición puntual, no de entrada.

## Consecuencias

- El proyecto pasa a tener dos lenguajes: C++ en `firmware/`, Python en `tools/`. Se
  documenta la frontera clara: `firmware/` es todo lo que corre en el ESP32 en tiempo
  real, `tools/` es procesamiento de datos en la PC sobre archivos ya capturados.
- **Hallazgo de la primera corrida real** (captura del control Garen,
  `docs/captures/garen-boton-2026-08-12-01.csv`): comparar tramas por duración cruda
  redondeada *no funciona* — hay deriva de reloj de cientos de µs a lo largo de la
  captura (jitter real de hardware), así que ninguna repetición coincide en
  microsegundos exactos aunque sea el mismo código. La comparación tuvo que rediseñarse
  para clasificar cada pulso por el cluster/símbolo al que pertenece (tolerante al
  jitter) en vez de comparar duraciones exactas. Con esa corrección, 18 de 23 tramas
  detectadas resultaron idénticas por símbolo — las primeras 5 son ruido/asentamiento
  inicial antes de que la señal se estabilizara.
