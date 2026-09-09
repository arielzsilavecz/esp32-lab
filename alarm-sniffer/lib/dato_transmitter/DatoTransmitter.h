#pragma once

#include <cstdint>

#include "DigitalPin.h"

namespace dato {

// Ancho de cada símbolo en un bus de colector abierto donde el bit se
// codifica en la duración de un único pulso, no en un par PWM (bajo, alto)
// como el control Garen (ver rf::PwmTiming). El nivel de cada pulso no
// codifica nada: alterna porque cada flanco invierte el nivel del bus, punto.
// Valores medidos en el bus DATO real: ~78-83us para "0", ~156-161us para
// "1" -- ver docs/hardware/xanaes-dato-protocol.md. Se generan en 80/160
// (relación 2:1 igual que lo medido) en vez de reproducir el promedio exacto:
// no hace falta más precisión que la que ya tolera el propio bus entre
// sesiones de captura distintas.
struct PulseWidthTiming {
  uint16_t zeroUs;
  uint16_t oneUs;
};

// Escribe una trama de bits en un bus de colector abierto manejando un
// transistor NPN en configuración open-drain (ver ADR-0008): el pin del
// ESP32 controla la base con lógica INVERTIDA respecto al nivel que aparece
// en el bus -- GPIO en alto satura el transistor y tira el bus a GND (nivel
// de bus bajo); GPIO en bajo lo corta y el pull-up del bus lo sube solo
// (nivel de bus alto). Esta clase expone su interfaz en términos del nivel
// del BUS: quien la usa no necesita acordarse de la inversión eléctrica.
//
// Deliberadamente sin parámetro de repeticiones (a diferencia de
// rf::RfTransmitter): no hay evidencia en las capturas de que el teclado
// real repita la trama de una tecla varias veces por cada apretada, así que
// una llamada a send() ya equivale a una pulsación.
class DatoTransmitter {
 public:
  DatoTransmitter(uint8_t pin, const PulseWidthTiming& timing);

  void begin() const;

  // Envía los `bitCount` bits menos significativos de `frame`, del más
  // significativo al menos. El bus arranca y termina en reposo (nivel alto,
  // transistor cortado) -- confirmado en las 12 teclas capturadas, todas
  // empiezan con el bus en alto.
  void send(uint32_t frame, uint8_t bitCount) const;

 private:
  void setBusLevel(bool busHigh) const;

  hardware::DigitalPin pin_;
  PulseWidthTiming timing_;
};

}  // namespace dato
