# Validación del transmisor — loopback por cable — 2026-08-18

- **Archivo de datos**: `esp32-tx-generada-2026-08-18.csv`
- **Qué es**: la onda que **genera el ESP32** (no el control remoto), capturada por el
  propio ESP32.
- **Montaje**: jumper directo de **GPIO32 (TX) a GPIO34 (RX)**, con el cable DATA del
  MX-05V desconectado. Sin RF de por medio.
- **Firmware**: Etapa 6, comando `l` (loopback). 10 repeticiones, 580 flancos.

## Por qué por cable y no por aire

El primer intento fue por RF con el FS1000A sin antena. Resultado: **0 flancos**
capturados durante la transmisión, contra 93 flancos de ruido ambiente en una captura
normal de 5s. El receptor no es que no oyó: se quedó mudo mientras el transmisor
emitía. Es saturación del AGC por campo cercano — un portador fuerte al lado clava la
salida del receptor en un nivel constante y desaparecen las transiciones.

Eso vuelve inútil el loopback por aire con los módulos a centímetros, pero de paso
confirma que el FS1000A está emitiendo. El loopback por cable elimina la RF, el AGC y
el acoplamiento, y mide exactamente lo que interesa: el timing que produce el driver.

## Resultado: onda idéntica

La secuencia de símbolos generada coincide **exactamente** con la del control original
(`garen-boton-2026-08-15-p1.csv` y `-p2.csv`):

```
001010110101010011010011010100110100101010110011001100110
```

Valida las tres cosas a la vez: la decodificación de los 28 bits, los cuatro tiempos del
`PwmTiming`, y que el driver parametrizado reconstruye la trama desde los bits en vez de
reproducir un array capturado.

## Jitter medido (cierra la pregunta abierta del ADR-0005)

| pulso | generada (σ) | original (σ) |
|-------|--------------|--------------|
| sync      | 6.3µs | 22.6µs |
| bit1 bajo | 0.1µs | 22.0µs |
| bit1 alto | 0.7µs | 21.8µs |
| bit0 bajo | 0.5µs | 22.5µs |
| bit0 alto | 0.9µs | 22.5µs |
| período   | 0.9µs |  2.2µs |

El bit-banging genera pulsos con desviación **submicrosegundo**. **No hace falta migrar
a RMT.**

Salvedad de interpretación: la comparación no es simétrica. Los ~22µs del control
incluyen el ruido de detección de flancos del camino RF, que el loopback por cable no
tiene. El σ de 2.2µs en el período del original muestra que su cristal es estable y que
el resto es ruido de medición, no del emisor.

## Sesgo sistemático de +5µs por pulso

Cada pulso generado sale ~5µs más largo que lo comandado (período 1439.2 vs 1429.0µs =
+10µs, o sea 2 pulsos × 5µs). Es el overhead fijo de `digitalWrite()` más el del lazo,
que se suma a cada `delayMicroseconds()`.

Es 1% sobre un pulso de 500µs, muy dentro de lo que tolera el receptor — el propio
control varía ±50µs entre repeticiones. **No se compensa**: restarle 5µs a cada
constante sería optimizar sin necesidad demostrada. Queda documentado por si alguna vez
aparece un receptor más exigente.

## Prueba contra el portón real — 2026-08-18

Dos transmisiones separadas por 5 segundos, con antena puesta en el FS1000A:

- señal 1: `[1352]` → `[1868]`, 516ms
- señal 2: `[8414]` → `[8930]`, 516ms

Los 516ms coinciden con lo previsto (10 repeticiones × 51.5ms).

**Resultado: el portón abrió.** La Etapa 6 queda validada de punta a punta: el ESP32
controla el portón con la trama reconstruida desde los 28 bits decodificados.

### Hallazgo: el control es de botón único con ciclo

La segunda señal **no cerró el portón: lo frenó** a mitad de recorrido. El control
implementa el ciclo clásico abrir → parar → cerrar sobre un mismo código: cada
pulsación avanza un paso de la máquina de estados del receptor, que vive en el motor,
no en el control.

Consecuencias para la Etapa 7 (servidor HTTP), que no son cosméticas:

- **No puede haber botones separados de "Abrir" y "Cerrar"** en la interfaz web. Hay un
  solo comando posible; la semántica la decide el estado del portón, que el ESP32 no
  conoce. El botón tiene que llamarse algo neutro tipo "Activar".
- **Hace falta un cooldown** entre disparos. Un doble toque accidental en el celular
  frena la hoja a mitad de camino en lugar de completar la maniobra — que es
  exactamente lo que pasó en esta prueba. El cooldown deja de ser una protección contra
  spam y pasa a ser un requisito funcional.
- Sin un sensor de posición, la interfaz **no puede mostrar si el portón está abierto o
  cerrado**. Pretender que sí sería mentirle al usuario. Si más adelante se quiere ese
  estado, hay que agregar hardware (final de carrera o sensor magnético), no software.
