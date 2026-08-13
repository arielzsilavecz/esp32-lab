# Receptor MX-05V — cableado

## Por qué 5V en VCC pero divisor en DATA

Son dos problemas distintos en dos líneas distintas:

- **Alimentación (`VCC`)**: el módulo está especificado para 5V. Alimentarlo a 3.3V lo
  deja fuera de su punto de operación — en pruebas se observó la línea de alimentación
  colapsar de 3.3V a ~1.3V bajo carga (resistencia VCC-GND del módulo ~7kΩ, descarta
  corto franco; consistente con el circuito interno intentando arrancar sin la tensión
  mínima que necesita). Por eso `VCC` va a 5V directo, sin divisor.
- **Señal (`DATA`)**: como el módulo se alimenta a 5V, su salida `DATA` también oscila
  entre 0V y 5V. Los GPIO del ESP32 no toleran más de ~3.6V, así que **esta línea sí**
  necesita bajarse antes de entrar al GPIO — ahí va el divisor resistivo. El divisor no
  toca la alimentación del módulo, solo esta señal.

## Cálculo del divisor (línea DATA únicamente)

```
DATA (0–5V) ---[R1 = 10kΩ]---+---[R2 = 20kΩ]--- GND
                              |
                            GPIO34 (0–3.3V)
```

`Vout = Vin × R2 / (R1 + R2) = 5V × 20k / (10k + 20k) = 3.33V`

3.33V está debajo del máximo absoluto del ESP32 (3.6V) y por encima del umbral de
"alto" lógico, así que el flanco se sigue leyendo correctamente como HIGH.

## Pinout

| MX-05V | Destino                                      |
|--------|-----------------------------------------------|
| VCC    | 5V (pin `VIN`/`5V` del ESP32, directo)         |
| GND    | GND común (ESP32 + protoboard)                 |
| DATA   | Nodo del divisor (R1 hacia DATA, R2 hacia GND) |
| —      | Nodo del divisor → **GPIO34**                  |

GND del ESP32 y GND de la fuente de 5V (si es externa) tienen que estar unidos —
sin GND común el divisor no tiene referencia y las lecturas son erráticas.

## Por qué GPIO34

Pin de solo-entrada (sin driver de salida, sin pull-up/down interno), no es pin de
boot/strapping. Ideal para una señal digital externa que solo se lee, nunca se escribe.
