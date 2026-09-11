#include <Arduino.h>
#include <WiFi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

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

struct ZoneStatus {
  bool zones[xanaes::kZoneCount];
};

// La captura no puede detenerse mientras HTTPS responde: una zona puede
// volver a reposo durante ese round-trip y su trama no se repite despues.
// Una cola de un elemento conserva siempre el estado mas reciente mientras
// la tarea de red envia o reintenta el anterior.
QueueHandle_t zoneStatusQueue = nullptr;
ZoneStatus lastQueuedStatus{};
bool hasLastQueuedStatus = false;

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

// Instrumentacion de latencia de red. Lo que interesa separar es el costo de
// un POST sobre una conexion TLS ya abierta del de uno que tiene que rehacer
// el handshake: los reportes solo salen cuando una zona cambia, asi que entre
// uno y otro pueden pasar horas y el socket muere por inactividad. Por eso se
// registra tambien cuanto estuvo ociosa la conexion antes de cada request.
uint32_t lastNetworkEndMs = 0;
bool hasNetworkActivity = false;

void logNetworkTiming(const String& what, uint32_t startMs) {
  const uint32_t endMs = millis();

  String msg = what + " en " + String(endMs - startMs) + "ms";
  if (hasNetworkActivity) {
    msg += " (conexion ociosa " + String(startMs - lastNetworkEndMs) + "ms antes)";
  } else {
    msg += " (primera request desde el arranque)";
  }

  lastNetworkEndMs = endMs;
  hasNetworkActivity = true;
  logger::info("main", msg.c_str());
}

bool reportZoneStatus(const bool zones[xanaes::kZoneCount]) {
  String json = "{\"zonas\":[";
  for (uint8_t i = 0; i < xanaes::kZoneCount; ++i) {
    if (i > 0) json += ",";
    json += zones[i] ? "true" : "false";
  }
  json += "]}";

  const uint32_t startMs = millis();
  const bool ok = backendClient.reportEstado(json);
  logNetworkTiming(ok ? "POST estado ok" : "POST estado FALLO", startMs);

  if (ok) {
    logger::info("main", ("estado reportado: " + json).c_str());
  }
  return ok;
}

// Railway cierra la conexion TLS ociosa a los 60s exactos (medido). Rehacer
// el handshake le cuesta ~1.9s a este ESP32 -- criptografia por software,
// contra 482ms de la misma conexion desde una PC -- mientras que un POST
// sobre una conexion ya abierta tarda ~250ms. Como entre cambio y cambio de
// zona pasan minutos u horas, sin esto practicamente ningun reporte real
// encontraria la conexion viva. 45s deja margen sobre los 60s medidos.
constexpr uint32_t kKeepWarmIntervalMs = 45000;

void keepConnectionWarm() {
  if (WiFi.status() != WL_CONNECTED) return;

  const uint32_t startMs = millis();
  // Solo se registra el fallo: esto corre cada 45s y loguear cada ping taparia
  // todo lo demas. Que el keep-warm funcione se ve en el tiempo del proximo
  // POST real, que es lo que importa medir.
  if (!backendClient.ping()) {
    logNetworkTiming("GET ping FALLO", startMs);
    return;
  }
  lastNetworkEndMs = millis();
  hasNetworkActivity = true;
}

void reportZoneStatusTask(void*) {
  ZoneStatus pending{};

  for (;;) {
    if (xQueueReceive(zoneStatusQueue, &pending, pdMS_TO_TICKS(kKeepWarmIntervalMs)) != pdTRUE) {
      keepConnectionWarm();
      continue;
    }

    // Si la red falla, conservar el estado y reintentar. Antes de cada
    // intento se toma una version mas nueva de la cola, si aparecio: para la
    // vista en vivo importa el estado actual, no reproducir cada transicion.
    for (;;) {
      ZoneStatus newer{};
      if (xQueueReceive(zoneStatusQueue, &newer, 0) == pdTRUE) pending = newer;

      if (WiFi.status() == WL_CONNECTED && reportZoneStatus(pending.zones)) {
        break;
      }

      logger::warn("main", "no se pudo reportar estado; reintento en 1s");
      vTaskDelay(pdMS_TO_TICKS(1000));
    }
  }
}

void enqueueZoneStatus(const bool zones[xanaes::kZoneCount]) {
  if (zoneStatusQueue == nullptr) return;

  ZoneStatus status{};
  for (uint8_t i = 0; i < xanaes::kZoneCount; ++i) status.zones[i] = zones[i];

  if (hasLastQueuedStatus) {
    bool changed = false;
    for (uint8_t i = 0; i < xanaes::kZoneCount; ++i) {
      if (status.zones[i] != lastQueuedStatus.zones[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
  }

  lastQueuedStatus = status;
  hasLastQueuedStatus = true;
  xQueueOverwrite(zoneStatusQueue, &status);
}

// Diagnostico: reencola el ultimo estado real decodificado, salteando el
// filtro de "solo si cambio", para poder medir el costo de un POST cuando uno
// quiera en vez de esperar a que una zona cambie sola. No inventa datos --
// reenvia el ultimo estado que efectivamente se leyo del bus. Pasa por la
// cola a proposito: el POST tiene que salir siempre desde la tarea de red,
// nunca desde el lazo principal, porque BackendClient no es seguro de usar
// desde dos tareas a la vez.
void forceReport() {
  if (!hasLastQueuedStatus) {
    logger::warn("main", "todavia no se decodifico ningun estado - activa una zona primero");
    return;
  }
  if (zoneStatusQueue == nullptr) return;

  logger::info("main", "reenviando ultimo estado conocido (diagnostico)");
  xQueueOverwrite(zoneStatusQueue, &lastQueuedStatus);
}

// Ciclo automatico de estado: corre solo, sin intervencion, en paralelo a
// los comandos manuales por serial ('c'/'s'/teclas). Se salta a si mismo
// mientras haya una captura manual en curso -- RfReceiver no soporta dos
// sesiones de captura superpuestas.
void pollStatusCycle() {
  if (capturing) return;

  dataCapture.startCapture();
  delay(kStatusCaptureWindowMs);
  dataCapture.stopCapture();

  bool zones[xanaes::kZoneCount];
  if (xanaes::decodeZoneStatus(dataCapture, zones)) {
    String detected = "estado detectado: [";
    for (uint8_t i = 0; i < xanaes::kZoneCount; ++i) {
      if (i > 0) detected += ",";
      detected += zones[i] ? "1" : "0";
    }
    detected += "]";
    logger::info("main", detected.c_str());
    enqueueZoneStatus(zones);
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
    case 'r':
      forceReport();
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

  zoneStatusQueue = xQueueCreate(1, sizeof(ZoneStatus));
  if (zoneStatusQueue == nullptr ||
      xTaskCreate(reportZoneStatusTask, "zone-report", 8192, nullptr, 1, nullptr) != pdPASS) {
    logger::warn("main", "no se pudo iniciar la tarea de reporte de zonas");
  }

  // A diferencia del porton (ventana fija de captura), esta sesion es
  // explicita y sin duracion predefinida: no sabemos cuanto tarda alguien en
  // caminar hasta el teclado real y apretar la tecla. 'c' arranca, 's' para.
  logger::info("main", "listo - 'c' arranca captura de DATO, 's' la para y vuelca el CSV");
  logger::info("main", "0-9, * o # simulan esa tecla en el teclado real (cuidado, panel en vivo)");
  logger::info("main", "monitoreando estado de zonas en ventanas de 200ms");
  logger::info("main", "'r' reenvia el ultimo estado (diagnostico de latencia de red)");
}

void loop() {
  pollSerialCommand();
  pollHeartbeat();
  pollStatusCycle();
  delay(10);
}
