#include "DatoTransmitter.h"

#include <Arduino.h>

namespace dato {

DatoTransmitter::DatoTransmitter(uint8_t pin, const PulseWidthTiming& timing)
    : pin_(pin, hardware::DigitalPin::Mode::Output), timing_(timing) {}

void DatoTransmitter::begin() const {
  pin_.begin();
  setBusLevel(true);  // reposo: bus en alto, transistor cortado
}

void DatoTransmitter::send(uint32_t frame, uint8_t bitCount) const {
  bool busLevel = true;  // el bus real arranca en reposo (alto) antes de la trama

  for (uint8_t remaining = bitCount; remaining > 0; --remaining) {
    const bool bit = (frame >> (remaining - 1)) & 1u;
    setBusLevel(busLevel);
    delayMicroseconds(bit ? timing_.oneUs : timing_.zeroUs);
    busLevel = !busLevel;
  }

  setBusLevel(true);  // libera la línea -- vuelve a reposo
}

void DatoTransmitter::setBusLevel(bool busHigh) const {
  pin_.write(!busHigh);  // lógica invertida: GPIO alto = tira el bus a bajo
}

}  // namespace dato
