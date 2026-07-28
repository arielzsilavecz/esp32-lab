#include "DigitalPin.h"

#include <Arduino.h>

namespace hardware {

namespace {

uint8_t toArduinoMode(DigitalPin::Mode mode) {
  switch (mode) {
    case DigitalPin::Mode::Input: return INPUT;
    case DigitalPin::Mode::Output: return OUTPUT;
    case DigitalPin::Mode::InputPullup: return INPUT_PULLUP;
  }
  return INPUT;
}

}  // namespace

DigitalPin::DigitalPin(uint8_t pin, Mode mode) : pin_(pin), mode_(mode) {}

void DigitalPin::begin() const { pinMode(pin_, toArduinoMode(mode_)); }

void DigitalPin::write(bool high) const { digitalWrite(pin_, high ? HIGH : LOW); }

bool DigitalPin::read() const { return digitalRead(pin_) == HIGH; }

}  // namespace hardware
