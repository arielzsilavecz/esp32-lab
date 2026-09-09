#include <Arduino.h>
#include <WiFi.h>

#include "BackendClient.h"
#include "DatoTransmitter.h"
#include "DigitalPin.h"
#include "Logger.h"
#include "RfReceiver.h"
#include "Secrets.h"
#include "XanaesProtocol.h"
#include "XanaesZoneDecoder.h"

namespace {

// GPIO34: solo-entrada, sin conflicto con flash ni pines de strapping. Mismo
// criterio que el receptor 433MHz del porton (ver docs/hardware/mx05v-wiring.md).
constexpr uint8_t kDataPin = 34;
constexpr uint8_t kLedPin = 2;

// GPIO27: no es pin de strapping, es bidireccional (no solo-entrada como el
// 34), y ya tiene un pull-down externo de 10k a GND en el cableado real para
// que el transistor quede cortado si el pin flota durante el boot del ESP32
// -- ver ADR-0008 y la explicacion de circuito dada al usuario.
constexpr uint8_t kDatoTxPin = 27;

// Cooldown minimo entre transmisiones: evita que un doble caracter llegado
// por serial (o alguien manteniendo apretada una tecla en la terminal)
// dispare dos pulsaciones simuladas seguidas sobre un panel de seguridad
// real. No es una limitacion del protocolo, es prudencia de operador.
constexpr uint32_t kDatoTxCooldownMs = 500;

hardware::DigitalPin led(kLedPin, hardware::DigitalPin::Mode::Output);

dato::DatoTransmitter datoTx(kDatoTxPin, dato::PulseWidthTiming{80, 160});
uint32_t lastDatoTxMs = 0;

// RfReceiver no tiene nada de especifico a RF en su implementacion: captura
// flancos de CUALQUIER pin digital por interrupcion, con timestamp y nivel.
// Se reusa tal cual para el bus DATO del panel de alarma -- ver
// docs/decisions/0007-alarm-sniffer.md por que no se creo un driver nuevo.
rf::RfReceiver dataCapture(kDataPin);

bool capturing = false;
uint32_t lastHeartbeatMs = 0;
constexpr uint32_t kHeartbeatIntervalMs = 1000;

net::BackendClient backendClient(secrets::kBackendUrl, secrets::kAlarmDeviceToken);

// La trama de estado dura ~18ms y el panel la repite 125ms despues. Una
// ventana de 143ms es el minimo teorico para garantizar que al menos una de
// las dos copias quede completa, independientemente de donde caiga el borde
// entre capturas. Se usan 200ms para dejar margen a variaciones de timing.
// Los huecos de hasta 14s medidos son entre CAMBIOS distintos y no justifican
// retener cada captura durante todo ese tiempo: el siguiente ciclo arranca
// apenas termina de procesar el anterior.
constexpr uint32_t kStatusCaptureWindowMs = 200;

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

// Simula apretar `key` en el teclado real, escribiendo la trama sobre DATO.
// Ver docs/decisions/0008-transmisor-dato.md -- el transistor esta cableado
// directo al bus real del panel, esto no es un ensayo de banco.
void sendKey(char key) {
  const int16_t code = xanaes::keyCode(key);
  if (code < 0) {
    logger::warn("main", "tecla no soportada");
    return;
  }

  const uint32_t now = millis();
  if (now - lastDatoTxMs < kDatoTxCooldownMs) {
    logger::warn("main", "cooldown de transmision, espera un momento");
    return;
  }
  lastDatoTxMs = now;

  logger::info("main", "enviando tecla por DATO");
  datoTx.send(xanaes::buildKeyFrame(static_cast<uint8_t>(code)), xanaes::kKeyFrameBitCount);
}

// No bloquea para siempre si el WiFi no esta disponible: captura manual y
// comandos por serial tienen que seguir andando sin red. Mismo criterio que
// firmware/src/main.cpp.
void connectWiFi() {
  logger::info("main", "conectando WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(secrets::kWifiSsid, secrets::kWifiPassword);

  const uint32_t deadline = millis() + 15000;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    logger::info("main", "WiFi conectado");
  } else {
    logger::warn("main", "WiFi no conecto - sigue la captura/serial, sin reporte de estado");
  }
}

void reportZoneStatus(const bool zones[xanaes::kZoneCount]) {
  String json = "{\"zonas\":[";
  for (uint8_t i = 0; i < xanaes::kZoneCount; ++i) {
    if (i > 0) json += ",";
    json += zones[i] ? "true" : "false";
  }
  json += "]}";

  if (backendClient.reportEstado(json)) {
    logger::info("main", ("estado reportado: " + json).c_str());
  } else {
    logger::warn("main", "no se pudo reportar estado al backend");
  }
}

// Ciclo automatico de estado: corre solo, sin intervencion, en paralelo a
// los comandos manuales por serial ('c'/'s'/teclas). Se salta a si mismo
// mientras haya una captura manual en curso -- RfReceiver no soporta dos
// sesiones de captura superpuestas.
void pollStatusCycle() {
  if (capturing) return;
  if (WiFi.status() != WL_CONNECTED) return;

  dataCapture.startCapture();
  delay(kStatusCaptureWindowMs);
  dataCapture.stopCapture();

  bool zones[xanaes::kZoneCount];
  if (xanaes::decodeZoneStatus(dataCapture, zones)) {
    reportZoneStatus(zones);
  }
  // Si la trama de estado no aparecio en esta ventana, no pasa nada: el
  // proximo ciclo arranca de inmediato y lo vuelve a intentar.
}

void pollSerialCommand() {
  if (!Serial.available()) return;

  const int incoming = Serial.read();
  switch (incoming) {
    case 'c':
      startCapture();
      break;
    case 's':
      stopCapture();
      break;
    case '\n':
    case '\r':
      break;  // fin de linea del monitor serie, no es una tecla
    default:
      sendKey(static_cast<char>(incoming));
      break;
  }
}

}  // namespace

void setup() {
  logger::begin(115200);
  led.begin();
  datoTx.begin();
  connectWiFi();

  // A diferencia del porton (ventana fija de captura), esta sesion es
  // explicita y sin duracion predefinida: no sabemos cuanto tarda alguien en
  // caminar hasta el teclado real y apretar la tecla. 'c' arranca, 's' para.
  logger::info("main", "listo - 'c' arranca captura de DATO, 's' la para y vuelca el CSV");
  logger::info("main", "0-9, * o # simulan esa tecla en el teclado real (cuidado, panel en vivo)");
  logger::info("main", "monitoreando estado de zonas en ventanas de 200ms");
}

void loop() {
  pollSerialCommand();
  pollHeartbeat();
  pollStatusCycle();
  delay(10);
}
