#pragma once

#include <cstddef>
#include <cstdint>

#include "DigitalPin.h"

namespace rf {

// Tiempos de una codificación PWM de período constante: cada bit es un par
// (bajo, alto) cuya suma es siempre la misma, y el reparto entre ambos lleva
// el valor del bit.
//
// Los cuatro tiempos son independientes a propósito. Podría parecer que basta
// con un "corto" y un "largo" que se intercambian, pero en el control Garen
// medido no es así: bit 1 = (1022, 407) y bit 0 = (545, 884). Los dos suman
// 1429µs, pero 1022 != 884 y 407 != 545. Un modelo de dos tiempos transmitiría
// una onda que no es la capturada.
struct PwmTiming {
  uint16_t syncHighUs;
  uint16_t oneLowUs;
  uint16_t oneHighUs;
  uint16_t zeroLowUs;
  uint16_t zeroHighUs;
  uint16_t gapUs;
};

// Transmite un código binario como onda PWM sobre un pin digital.
//
// Genera la onda desde (código + tiempos) en vez de reproducir un array de
// duraciones capturado: el mismo driver sirve para cualquier control de esta
// familia cambiando las constantes, no solo para el que se capturó.
class RfTransmitter {
 public:
  RfTransmitter(uint8_t pin, const PwmTiming& timing);

  void begin() const;

  // Envía los `bitCount` bits menos significativos de `code`, del más
  // significativo al menos, repitiendo la trama `repetitions` veces.
  // Bloqueante: una trama de 28 bits dura ~51ms, así que 10 repeticiones
  // ocupan medio segundo.
  void send(uint32_t code, uint8_t bitCount, uint8_t repetitions) const;

 private:
  void sendFrame(uint32_t code, uint8_t bitCount) const;
  void sendBit(bool bit) const;

  hardware::DigitalPin pin_;
  PwmTiming timing_;
};

}  // namespace rf
