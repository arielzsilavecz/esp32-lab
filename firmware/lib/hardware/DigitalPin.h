#pragma once

#include <cstdint>

namespace hardware {

// Wrapper fino sobre pinMode/digitalWrite/digitalRead. El constructor solo
// guarda el número de pin y el modo: la llamada real a pinMode() se hace en
// begin(), no en el constructor, porque en ESP32 los objetos globales se
// construyen antes de que el runtime de Arduino termine de inicializar el
// periférico de GPIO — llamar pinMode() ahí es terreno inestable.
class DigitalPin {
 public:
  enum class Mode : uint8_t { Input, Output, InputPullup };

  DigitalPin(uint8_t pin, Mode mode);

  void begin() const;

  void write(bool high) const;
  bool read() const;

 private:
  uint8_t pin_;
  Mode mode_;
};

}  // namespace hardware
