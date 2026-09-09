#include <Arduino.h>

#include "DigitalPin.h"
#include "Logger.h"
#include "RfReceiver.h"

namespace {

// GPIO34: solo-entrada, sin conflicto con flash ni pines de strapping. Mismo
// criterio que el receptor 433MHz del porton (ver docs/hardware/mx05v-wiring.md).
constexpr uint8_t kDataPin = 34;
constexpr uint8_t kLedPin = 2;

hardware::DigitalPin led(kLedPin, hardware::DigitalPin::Mode::Output);

// RfReceiver no tiene nada de especifico a RF en su implementacion: captura
// flancos de CUALQUIER pin digital por interrupcion, con timestamp y nivel.
// Se reusa tal cual para el bus DATO del panel de alarma -- ver
// docs/decisions/0007-alarm-sniffer.md por que no se creo un driver nuevo.
rf::RfReceiver dataCapture(kDataPin);

bool capturing = false;
uint32_t lastHeartbeatMs = 0;
constexpr uint32_t kHeartbeatIntervalMs = 1000;

// Mismo formato que exportCapture() en firmware/src/main.cpp a proposito:
// tools/analyze_capture.py y compare_captures.py funcionan sobre esta
// captura sin cambiarles una linea.
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

void startCapture() {
  if (capturing) {
    logger::warn("main", "ya hay una captura en curso");
    return;
  }
  logger::info("main", "capturando DATO - apreta la tecla real en el teclado, 's' para parar");
  led.write(true);
  dataCapture.startCapture();
  capturing = true;
}

void stopCapture() {
  if (!capturing) {
    logger::warn("main", "no hay captura en curso");
    return;
  }
  dataCapture.stopCapture();
  led.write(false);
  capturing = false;

  if (dataCapture.overflowed()) {
    logger::warn("main", "buffer lleno - puede faltar el final de la trama");
  }
  exportCapture(dataCapture);
}

// No lee nada del buffer de captura (no es seguro mientras esta activa, ver
// nota en RfReceiver.h) -- solo confirma que el firmware sigue vivo mientras
// se espera a que alguien vaya hasta el teclado real y apriete la tecla.
void pollHeartbeat() {
  if (!capturing) return;
  const uint32_t now = millis();
  if (now - lastHeartbeatMs < kHeartbeatIntervalMs) return;
  lastHeartbeatMs = now;
  Serial.println("... capturando, todavia no se recibio 's'");
}

void pollSerialCommand() {
  if (!Serial.available()) return;

  switch (Serial.read()) {
    case 'c':
      startCapture();
      break;
    case 's':
      stopCapture();
      break;
    default:
      break;  // ignora newlines y cualquier otra tecla
  }
}

}  // namespace

void setup() {
  logger::begin(115200);
  led.begin();

  // A diferencia del porton (ventana fija de captura), esta sesion es
  // explicita y sin duracion predefinida: no sabemos cuanto tarda alguien en
  // caminar hasta el teclado real y apretar la tecla. 'c' arranca, 's' para.
  logger::info("main", "listo - 'c' arranca captura de DATO, 's' la para y vuelca el CSV");
}

void loop() {
  pollSerialCommand();
  pollHeartbeat();
  delay(10);
}
