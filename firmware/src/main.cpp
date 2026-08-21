#include <Arduino.h>

#include "Config.h"
#include "DigitalPin.h"
#include "Logger.h"
#include "RfReceiver.h"
#include "RfTransmitter.h"

namespace {

// Conocimiento específico del control Garen medido el 2026-08-15 — capa de
// aplicación, no del driver. Derivado de las capturas, no asumido: ver
// docs/captures/garen-boton-2026-08-15-fijo-vs-rolling.md.
constexpr rf::PwmTiming kGarenTiming{
    /*syncHighUs=*/413,
    /*oneLowUs=*/1022,
    /*oneHighUs=*/407,
    /*zeroLowUs=*/545,
    /*zeroHighUs=*/884,
    /*gapUs=*/11136,
};
constexpr uint32_t kGarenCode = 0x1EDD855;  // 0001111011011101100001010101
constexpr uint8_t kGarenBitCount = 28;
constexpr uint8_t kGarenRepetitions = 10;  // el control original manda ~14

hardware::DigitalPin led(config::kLedPin, hardware::DigitalPin::Mode::Output);
hardware::DigitalPin triggerButton(config::kTriggerButtonPin,
                                    hardware::DigitalPin::Mode::InputPullup);
rf::RfReceiver rfReceiver(config::kRfReceiverPin);
rf::RfTransmitter rfTransmitter(config::kRfTransmitterPin, kGarenTiming);

bool triggerWasPressed = false;
uint32_t lastTriggerMs = 0;

// Export en CSV plano por Serial (no por logger::, que antepone timestamp/tag
// a cada línea y rompería el formato).
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

void runCapture() {
  logger::info("main", "capturando RF - apreta el control remoto ahora");
  led.write(true);
  rfReceiver.startCapture();
  delay(config::kCaptureWindowMs);
  rfReceiver.stopCapture();
  led.write(false);

  if (rfReceiver.overflowed()) {
    logger::warn("main", "buffer de captura lleno - puede faltar el final de la trama");
  }
  exportCapture(rfReceiver);
}

void runTransmit() {
  logger::info("main", "transmitiendo trama Garen");
  led.write(true);
  rfTransmitter.send(kGarenCode, kGarenBitCount, kGarenRepetitions);
  led.write(false);
  logger::info("main", "transmision terminada");
}

// Captura la propia transmisión para comparar la onda generada contra la
// capturada del control original. Sacarle la antena al TX antes de usarlo: a
// pocos centímetros satura el AGC del receptor y los tiempos salen
// distorsionados.
void runLoopback() {
  logger::info("main", "loopback: capturando la propia transmision");
  led.write(true);
  rfReceiver.startCapture();
  rfTransmitter.send(kGarenCode, kGarenBitCount, kGarenRepetitions);
  rfReceiver.stopCapture();
  led.write(false);

  if (rfReceiver.overflowed()) {
    logger::warn("main", "buffer lleno durante el loopback");
  }
  exportCapture(rfReceiver);
}

// El ESP32 como control remoto: apretar BOOT dispara la trama. Se detecta el
// flanco de pulsacion (no el nivel) para que mantenerlo apretado no repita la
// orden, y el cooldown descarta el rebote mecanico de paso.
void pollTriggerButton() {
  const bool pressed = !triggerButton.read();  // activo en bajo

  if (pressed && !triggerWasPressed) {
    const uint32_t now = millis();
    if (now - lastTriggerMs >= config::kTriggerCooldownMs) {
      runTransmit();
      lastTriggerMs = millis();
    } else {
      logger::warn("main", "pulsacion ignorada: en cooldown");
    }
  }
  triggerWasPressed = pressed;
}

void pollSerialCommand() {
  if (!Serial.available()) return;

  switch (Serial.read()) {
    case 't':
      runTransmit();
      lastTriggerMs = millis();  // el cooldown tambien aplica al comando serial
      break;
    case 'c':
      runCapture();
      break;
    case 'l':
      runLoopback();
      break;
    default:
      break;  // ignora newlines y cualquier otra tecla
  }
}

}  // namespace

void setup() {
  logger::begin(config::kSerialBaudRate);
  led.begin();
  triggerButton.begin();
  rfTransmitter.begin();

  // Deliberadamente no se transmite en el arranque: enchufar el USB no debe
  // abrir el porton.
  logger::info("main", "listo - boton BOOT transmite; 't' transmitir, 'c' capturar, 'l' loopback");
}

void loop() {
  pollTriggerButton();
  pollSerialCommand();
  delay(10);  // antirrebote simple; no compite con nada mas en el lazo
}
