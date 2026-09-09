# Captura — botón "casita" + código de usuario — 2026-09-07

- **Archivo**: `xanaes-casita-mas-clave-2026-09-07.csv`
- **Qué se apretó**: el botón con ícono de casa, una sola vez y breve — y después, al
  ver una reacción inesperada, los 4 dígitos del código de usuario (dos veces, la
  segunda mientras el sistema empezaba a armar).

## ⚠️ Este botón puso el panel en un estado no identificado con certeza

Al apretarlo, el LED PROGRAMA empezó a titilar y, al ingresar dígitos, se prendieron
LEDs de zona (1, 2 y 4) en vez de interpretarse como código — señal de estar dentro de
una pantalla de programación que usa los LEDs de zona para mostrar estado de opciones
(mismo patrón que las posiciones 08, 190-209, 211-225 del manual: cada tecla numérica
prende/apaga la opción de esa zona en vez de ser un dígito de clave).

**No se identificó con certeza qué posición/función es esta** — el manual no documenta
explícitamente que el botón casita entre en programación directamente. Se resolvió
ingresando el código de usuario normal (dos veces, la segunda durante un intento de
armado), tras lo cual el panel volvió a su estado normal sin daño aparente.

**Zonas 2 y 4 no tienen ningún cable en su borne** en esta instalación (solo Zona 1 está
wireada, a través del teclado) — el titileo de esas dos es consistente con una entrada
"Normal Cerrada" sin terminar, no necesariamente algo que haya causado este incidente.

**Recomendación**: no volver a apretar este botón solo hasta identificar con certeza su
función real (por ejemplo, preguntando al instalador, o revisando el Manual del
Usuario que falta). Si se repite el experimento, tener a mano el código de usuario listo
para ingresar de inmediato.

## Código capturado

Igual estructura que las 12 teclas ya mapeadas (22 símbolos, posiciones 0-10 y 18-21
fijas): posiciones 11-17 = **0101101** — distinto de las 12 teclas del teclado numérico,
confirmando que es un botón físico separado con su propio código.

## Validación adicional de la tabla de 12 teclas

Los 4 dígitos del código de usuario, ingresados en un contexto real (no una prueba
armada), decodificaron exactamente contra la tabla ya construida en
`xanaes-teclas-completas-2026-09-07.md` — refuerza la confianza en esa tabla, ahora
validada tanto por repetición controlada como por uso real.
