# Transmisor FS1000A — cableado

## Pinout

| FS1000A | Destino                        |
|---------|--------------------------------|
| VCC     | 5V (`VIN`/`5V` del ESP32)       |
| GND     | GND común (ESP32 + protoboard)  |
| DATA    | **GPIO32** (directo, sin divisor) |

A diferencia del receptor, acá **no hace falta divisor**: la señal va del ESP32
*hacia* el módulo, así que nunca entran 5V a un GPIO. Los 3.3V de salida del ESP32
alcanzan para excitar la entrada de datos del FS1000A.

## Por qué GPIO32

Salida completa (34/35/36/39 son solo entrada y no servirían), no es pin de strapping
ni está conectado a la flash SPI, y queda en la misma columna que el GPIO34 del
receptor para simplificar el cableado en protoboard. Los pines 32/33 son también los
del cristal de 32.768kHz para RTC externo, que en el WROOM-32 no viene poblado.

## Antena

Alambre recto de **17.3cm** (λ/4 a 433.92MHz; con el efecto de punta el óptimo real
cae en ~16.4cm). Recta y vertical, lejos de metal. Sin antena el alcance es de
centímetros.

Una antena helicoidal como las del kit también funciona, pero es un monopolo cargado
inductivamente: más corta a cambio de menos eficiencia y menos ancho de banda. El
alambre recto rinde más.

## Cuidado con el loopback

Para validar la transmisión capturándola con el propio MX-05V (comando `l` del
firmware), **sacarle la antena al FS1000A**. A pocos centímetros el transmisor satura
el AGC del receptor y los tiempos capturados salen distorsionados — parece un bug del
driver cuando en realidad es acoplamiento de campo cercano.

## Consumo

En reposo consume poco; transmitiendo, decenas de mA. Si el módulo se alimenta desde
el pin `5V` del ESP32, esa línea viene directo de VBUS del USB: un cableado invertido
o un corto ahí carga VBUS y puede hacer que el puerto USB se caiga entero. Ante un
puerto que desaparece, medir la resistencia VCC-GND del módulo desconectado.
