# ADR-0011: Luces y disyuntor en la pagina via puente NEO <-> Home Assistant

## Estado

Aceptado

## Fecha

2026-11-09

## Contexto

Home Assistant (en NEO) ya controla dos focos CozyLife (local, LAN) y un disyuntor
Tuya con medicion de energia (nube de Tuya). El usuario quiere controlarlos desde la
misma pagina que el porton y la alarma (`casa-piotti.up.railway.app`), con metricas
del disyuntor en vivo e historial consultable, como en la app Smart Life.

## Decision

- **Un dispositivo del backend por cosa controlable** (`tipo` `luz` o `disyuntor`),
  con token propio. Es el modelo generico de ADR-0006: filas nuevas, sin tablas nuevas.
- **Puente en NEO** (`tools/neo-bridge/bridge.py`, systemd `neo-bridge.service`):
  un hilo por dispositivo que pide la orden pendiente cada ~1 s, la ejecuta en Home
  Assistant por su API local y reporta el estado a `POST /api/device/estado`. Sale
  hacia Railway como el ESP32: no se expone Home Assistant ni se abre ningun puerto.
  Solo biblioteca estandar de Python.
- **Lista cerrada de comandos en dos lugares**: backend (`COMANDOS_PERMITIDOS`) y
  puente (`SERVICIOS`). `tipo_comando` es texto libre en la base.
- **Cortar el disyuntor exige verificacion biometrica** (la misma WebAuthn del
  porton); conectarlo no. Las luces no la exigen.
- **Historial con politica** (`src/historyPolicy.js`): el estado actual se actualiza
  y se emite por SSE en cada reporte, pero en `estados` solo se guarda una fila si
  hubo cambio de encendido o paso el intervalo (disyuntor 1 min, luces 10 min). Sin
  esto, el disyuntor reportando cada 5 s serian ~17.000 filas/dia.
- **Grafico de potencia en SVG plano**, sin libreria de graficos: una sola serie.

## Alternativas consideradas

- **Exponer Home Assistant por Tailscale Funnel o por la IP publica** y que la
  pagina lo llame directo: descartada, expone Home Assistant y su token a Internet.
- **Un solo dispositivo "casa" con varias entidades**: obligaria a agregar un
  destino a cada comando (`comandos` no tiene payload). Una fila por cosa controlable
  reutiliza todo lo existente.
- **Guardar cada reporte del disyuntor**: descartado por volumen; 1 por minuto
  alcanza para el grafico diario.
- **Google Home como fuente**: no ofrece API para leer dispositivos de terceros.

## Consecuencias

- Controlar luces y disyuntor desde la pagina depende de NEO, Home Assistant,
  Railway e Internet (el disyuntor ademas depende de la nube de Tuya). Home Assistant
  y las apps de cada fabricante siguen funcionando aparte.
- Las ordenes heredan la politica del porton: vencen a los 5 s y exigen contacto del
  dispositivo en los ultimos 10 s.
- El token de Home Assistant vive en NEO (`/etc/neo-bridge-ha.token`, root 600) y da
  control total de Home Assistant: si NEO se compromete, hay que revocarlo desde el
  perfil de Home Assistant.

## Etapa 2: brillo, blanco y color (2026-11-09)

- **`comandos.parametros` (JSONB, migracion 010)** para la orden `ajustar` de una luz:
  `{brillo}` (1-100), `{temperatura_k}` (2000-6535, rango de los focos segun Home
  Assistant) o `{color}` (`#rrggbb`); blanco y color son excluyentes. Se descarto
  codificar el valor dentro de `tipo_comando` (`"brillo:60"`): mas fragil y sin
  forma limpia de validarlo. La columna es generica: sirve para cualquier orden
  futura con valores. Las ordenes sin valores guardan null.
- Validacion en dos barreras: `src/lightParams.js` (backend) y `ajuste_a_ha`
  (puente). El puente traduce a `light.turn_on` (`brightness_pct`,
  `color_temp_kelvin`, `rgb_color`); como en Home Assistant, ajustar tambien enciende.
- La pagina manda una orden por gesto (al soltar el deslizador, no por pixel) y
  como mucho una en vuelo por foco: si se sigue moviendo, se envia solo el ultimo
  pedido.
- El puente reporta `modo` (`blanco`/`color`), `temperatura_k` y `color`; la pagina
  pinta el indicador de cada foco con su color real.
