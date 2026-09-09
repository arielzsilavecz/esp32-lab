# Sniffer de alarma — cableado de DATO

Ver `docs/decisions/0007-alarm-sniffer.md` para el por qué del diseño general. Panel:
Xanaes 610 (manual del instalador v4.00, provisto por el usuario).

## Confirmado por el manual del fabricante

El teclado se conecta a la central con **3 hilos**: DATO, +12V y GND (cable tipo
telefónico con malla, la malla va al negativo del sistema) — confirma que el tercer hilo
para el GND compartido existe estructuralmente, no es algo que haya que improvisar.

**DATO es un bus compartido**, no un enlace punto a punto: el panel admite hasta 3
teclados en la misma línea. Esperar tráfico en las dos direcciones intercalado (el panel
hacia el/los teclados — polling, estado de LEDs — y el teclado hacia el panel — tecla
apretada) en el mismo cable. No cambia nada del hardware ni del firmware del sniffer,
pero sí importa para el análisis: no asumir que todo lo capturado es "la tecla que
apretaste".

**Lo que el manual NO documenta** (y sigue siendo el objetivo de este sniffer): el
protocolo a nivel de bits de DATO. Los códigos "Contact ID" del apéndice del manual son
del discador telefónico hacia la central de monitoreo — un canal completamente distinto
(línea de teléfono), sin relación con DATO. No confundir uno con otro.

## Pinout

| Panel de alarma | Destino                              |
|------------------|--------------------------------------|
| DATO (~12V)      | Divisor → **GPIO34** del ESP32        |
| GND              | GND común (panel + ESP32) — ver nota  |

## Divisor resistivo (obligatorio)

```
DATO ~12V
  |
 33k
  |
  +------ GPIO34
  |
 10k
  |
 GND
```

Con el riel +12V medido con multímetro en **12.45V** (no un supuesto): 12.45 × 10/(33+10)
≈ **2.90V**. Margen cómodo por debajo del máximo de GPIO (3.3V) y por encima del umbral
mínimo de nivel alto del ESP32 (~2.47V) — ni satura ni se lee como indeterminado.

**GND verificado**: diferencia de potencial medida entre GND del panel y GND del ESP32
= 0V. Unir los GND es seguro.

Si en algún momento se mide un pico por encima de 12V (ej. carga de batería de respaldo
llevando el riel a 13.5-13.8V), recalcular: a 13.8V este mismo divisor da ~3.21V, ya con
poco margen. Volver a medir antes de confiar en el número si el panel tiene batería de
respaldo cargando.

## Topología eléctrica: colector abierto (medido)

Confirmado con el panel prendido, sin desconectar nada: con DATO en reposo (~11.4V) se
conectó una resistencia de prueba de 10kΩ entre DATO y GND, y la tensión bajó a 9.1V.
Resolviendo el circuito como divisor da un **pull-up interno de ~2.7kΩ hacia +12V** —
firma característica de colector abierto (una salida push-pull activa apenas se hubiera
movido con esa carga). Detalle completo y la cuenta en ADR-0008.

Esto importa para cualquier diseño que **escriba** en DATO (no solo escuche): al ser
colector abierto, una salida propia tiene que ser también de colector/drenador abierto
(solo tirar a GND, nunca empujar a alto) para no arriesgar un conflicto eléctrico con
el teclado o el panel reales — ver ADR-0008 para el diseño del transmisor.

## Por qué GPIO34

Solo-entrada, sin conflicto con flash ni pines de strapping — mismo criterio que el
receptor 433MHz del portón (`docs/hardware/mx05v-wiring.md`).

## Puesta a tierra — leer antes de cablear

Antes de unir el GND del panel al GND del ESP32, medir con multímetro (en modo voltaje,
AC y DC) la diferencia de potencial entre ambos puntos de GND *antes* de conectarlos. El
panel tiene su propia fuente (transformador + batería de respaldo); el ESP32 se alimenta
del USB de la PC. Si hay una diferencia de potencial inesperada entre ambos grounds,
unirlos a lo bruto puede crear un camino de corriente de falla no previsto. Si la
lectura da ~0V, unir los GND es seguro.

## Qué no se asume

Ningún protocolo del bus DATO — ni siquiera por analogía con buses de teclado de otras
marcas de alarma. Se descubre con la captura real, igual que con el control Garen.
