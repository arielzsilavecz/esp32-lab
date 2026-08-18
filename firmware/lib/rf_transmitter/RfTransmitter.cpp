#include "RfTransmitter.h"

#include <Arduino.h>

namespace rf {

RfTransmitter::RfTransmitter(uint8_t pin, const PwmTiming& timing)
    : pin_(pin, hardware::DigitalPin::Mode::Output), timing_(timing) {}

void RfTransmitter::begin() const {
  pin_.begin();
  pin_.write(false);  // en reposo la portadora va apagada, no al aire
}

void RfTransmitter::send(uint32_t code, uint8_t bitCount, uint8_t repetitions) const {
  for (uint8_t repetition = 0; repetition < repetitions; ++repetition) {
    sendFrame(code, bitCount);
  }
  pin_.write(false);
}

void RfTransmitter::sendFrame(uint32_t code, uint8_t bitCount) const {
  pin_.write(true);
  delayMicroseconds(timing_.syncHighUs);

  for (uint8_t remaining = bitCount; remaining > 0; --remaining) {
    sendBit((code >> (remaining - 1)) & 1u);
  }

  pin_.write(false);
  delayMicroseconds(timing_.gapUs);
}

void RfTransmitter::sendBit(bool bit) const {
  pin_.write(false);
  delayMicroseconds(bit ? timing_.oneLowUs : timing_.zeroLowUs);
  pin_.write(true);
  delayMicroseconds(bit ? timing_.oneHighUs : timing_.zeroHighUs);
}

}  // namespace rf
