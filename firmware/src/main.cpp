#include <Arduino.h>

namespace {
// GPIO2 es el LED integrado en la mayoría de los DevKit WROOM-32; no es un
// estándar del chip, verificar contra el serigrafiado de la placa si no prende.
constexpr uint8_t kLedPin = 2;
constexpr uint32_t kBlinkIntervalMs = 500;
}  // namespace

void setup() {
  Serial.begin(115200);
  pinMode(kLedPin, OUTPUT);
  Serial.println("esp32-lab: bring-up OK");
}

void loop() {
  digitalWrite(kLedPin, HIGH);
  delay(kBlinkIntervalMs);
  digitalWrite(kLedPin, LOW);
  delay(kBlinkIntervalMs);
  Serial.println("blink");
}
