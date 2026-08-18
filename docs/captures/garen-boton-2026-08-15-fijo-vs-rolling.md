# Experimento — ¿código fijo o rolling? — 2026-08-15

- **Archivos**: `garen-boton-2026-08-15-p1.csv`, `-p2.csv`, `-p3.csv`
- **Hardware**: ESP32 WROOM-32 + MX-05V (5V, divisor 10kΩ/20kΩ → GPIO34)
- **Firmware**: Etapa 3, `RfReceiver`, ventana fija de 5000ms post-boot
- **Procedimiento**: tres **pulsaciones separadas** (reset de placa entre cada una),
  botón apretado una vez y corto. 812 flancos por captura, 14 tramas cada una, las 14
  repeticiones idénticas dentro de cada captura.

## Pregunta

¿El control transmite siempre la misma trama (código fijo) o una distinta por pulsación
(rolling code)? De esto depende que el replay pueda abrir el portón.

La captura del 2026-08-12 **no** respondía esto: sus 18 tramas idénticas eran
repeticiones dentro de una misma pulsación, y un rolling code también repite el mismo
código mientras se mantiene apretado el botón. Hacía falta comparar entre pulsaciones.

## Resultado: CÓDIGO FIJO

Las tres pulsaciones producen secuencias de símbolos idénticas
(`tools/compare_captures.py`). El replay de una captura debería abrir el portón.

## Estructura de la trama

Verificado sobre los datos, no asumido:

- 57 pulsos = **1 pulso de sync** (alto, 468µs) + 56 pulsos = **28 pares**
- Los 28 pares son todos (bajo, alto) — sin excepción
- **Período constante: 1428.8µs**, min 1423 / max 1432, σ=2.3µs (0.16% — encoder con
  cristal, no RC)
- El bit va en el **duty cycle**, con dos grupos limpios: 0.317 y 0.667 (≈1:2 y 2:1).
  Es codificación PWM clásica.
- Duración de trama ≈ 468µs + 28 × 1429µs ≈ 40.5ms, coincide con los ~40.4ms medidos.

### Bits

Con la convención **1 = bajo largo + alto corto** (arbitraria hasta conocer la del
fabricante):

```
0001111011011101100001010101
```

28 bits, iguales en las tres capturas.

## Lo que todavía no se sabe

- **Qué bits son dirección y cuáles son botón.** Se resuelve capturando otro botón del
  mismo control: los bits que cambian son el código de botón, los que quedan son la
  dirección. Experimento barato, pendiente.
- La convención de bit del fabricante (si `1` es el par corto-largo o al revés). Para
  replay no importa; para una API de transmisión parametrizada, sí.
