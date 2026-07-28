#include <Arduino.h>

#include "Config.h"
#include "DigitalPin.h"
#include "Logger.h"

namespace {
hardware::DigitalPin led(config::kLedPin, hardware::DigitalPin::Mode::Output);
}  // namespace

void setup() {
  logger::begin(config::kSerialBaudRate);
  led.begin();
  logger::info("main", "esp32-lab: bring-up OK");
}

void loop() {
  led.write(true);
  delay(config::kBlinkIntervalMs);
  led.write(false);
  delay(config::kBlinkIntervalMs);
  logger::debug("main", "blink");
}
