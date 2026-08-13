#include <Arduino.h>

#include "Config.h"
#include "DigitalPin.h"
#include "Logger.h"
#include "RfReceiver.h"

namespace {

hardware::DigitalPin led(config::kLedPin, hardware::DigitalPin::Mode::Output);
rf::RfReceiver rfReceiver(config::kRfReceiverPin);

// Export en CSV plano por Serial (no por logger::, que antepone timestamp/tag
// a cada línea y rompería el formato). Los marcadores de inicio/fin hacen
// fácil ubicar el bloque y copiarlo a docs/captures/.
void exportCapture(const rf::RfReceiver& receiver) {
  Serial.println("--- CAPTURE CSV START ---");
  Serial.println("index,timestamp_us,duration_us,level");
  const size_t edgeCount = receiver.count();
  uint32_t previousTimestamp = 0;
  for (size_t i = 0; i < edgeCount; ++i) {
    const rf::Edge& edge = receiver.edgeAt(i);
    const uint32_t durationUs = (i == 0) ? 0 : edge.timestampUs - previousTimestamp;
    Serial.printf("%u,%u,%u,%d\n", static_cast<unsigned>(i), edge.timestampUs, durationUs,
                  edge.level ? 1 : 0);
    previousTimestamp = edge.timestampUs;
  }
  Serial.println("--- CAPTURE CSV END ---");
}

}  // namespace

void setup() {
  logger::begin(config::kSerialBaudRate);
  led.begin();

  logger::info("main", "capturando RF - apreta el control remoto ahora");
  led.write(true);

  rfReceiver.startCapture();
  delay(config::kCaptureWindowMs);
  rfReceiver.stopCapture();

  led.write(false);

  if (rfReceiver.overflowed()) {
    logger::warn("main", "buffer de captura lleno - puede faltar el final de la trama");
  }
  logger::info("main", "captura terminada, exportando");
  exportCapture(rfReceiver);
}

void loop() {
  delay(1000);
}
