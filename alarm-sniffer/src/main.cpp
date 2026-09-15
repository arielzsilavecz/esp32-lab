#include <Arduino.h>
#include <WiFi.h>
#include <esp_attr.h>  // IRAM_ATTR
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

#include "BackendClient.h"
#include "DigitalPin.h"
#include "Logger.h"
#include "RfReceiver.h"
#include "RfTransmitter.h"
#include "Secrets.h"
#include "XanaesZoneDecoder.h"

namespace {

// GPIO34: solo-entrada, sin conflicto con flash ni pines de strapping. Mismo
// criterio que el receptor 433MHz del porton (ver docs/hardware/mx05v-wiring.md).
constexpr uint8_t kDataPin = 34;
constexpr uint8_t kLedPin = 2;

// GPIO25: salida completa, no es pin de strapping. DATA del FS1000A para
// abrir el porton (control Garen) -- ver docs/hardware/fs1000a-wiring.md.
constexpr uint8_t kRfTransmitterPin = 25;

// GPIO4: no es pin de strapping y esta libre en esta placa. GPIO0 (el que usa
// el boton BOOT en el firmware original del porton) no esta expuesto en el
// header de este DevKit de 38 pines -- confirmado con multimetro, sin
// continuidad en ningun pin del header al apretar BOOT.
constexpr uint8_t kTriggerButtonPin = 4;

// Mismo criterio que el porton actual (firmware/lib/config/Config.h): el
// control es de boton unico con ciclo abrir->parar->cerrar, asi que una
// segunda pulsacion accidental frena la hoja a mitad de camino en vez de
// repetir la orden. No es una proteccion contra spam, es un requisito
// funcional del control.
constexpr uint32_t kTriggerCooldownMs = 3000;

// Conocimiento especifico del control Garen medido el 2026-08-15 -- capa de
// aplicacion, no del driver. Copiado tal cual de firmware/src/main.cpp: ver
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

hardware::DigitalPin led(kLedPin, hardware::DigitalPin::Mode::Output);
hardware::DigitalPin triggerButton(kTriggerButtonPin, hardware::DigitalPin::Mode::InputPullup);
rf::RfTransmitter rfTransmitter(kRfTransmitterPin, kGarenTiming);

// Por interrupcion, no por sondeo: pollStatusCycle() bloquea el loop() ~200ms
// por vuelta (la ventana de captura de DATO, encadenada sin pausa), asi que
// una lectura de nivel del boton en el loop principal puede no coincidir con
// una pulsacion corta -- con dos pulsadores en serie (hay que apretar los dos
// a la vez) el solape real de ambos contactos puede durar menos que eso. Una
// interrupcion en el flanco no depende de cuando el loop() llega a mirar el
// pin: se latchea en el instante exacto, sin importar que tan ocupado este.
volatile bool triggerButtonEdgePending = false;

void IRAM_ATTR onTriggerButtonPressed() {
  triggerButtonEdgePending = true;
}

uint32_t lastTriggerMs = 0;

// RfReceiver no tiene nada de especifico a RF en su implementacion: captura
// flancos de CUALQUIER pin digital por interrupcion, con timestamp y nivel.
// Se reusa tal cual para el bus DATO del panel de alarma -- ver
// docs/decisions/0007-alarm-sniffer.md por que no se creo un driver nuevo.
rf::RfReceiver dataCapture(kDataPin);

bool capturing = false;
uint32_t lastHeartbeatMs = 0;
constexpr uint32_t kHeartbeatIntervalMs = 1000;

net::BackendClient backendClient(secrets::kBackendUrl, secrets::kAlarmDeviceToken);

// Cliente aparte para el porton, autenticado con SU token (no el de la
// alarma): son dos identidades de dispositivo distintas del lado del
// backend (dos filas en `dispositivos`), aunque compartan el mismo ESP32
// fisico -- mismo modelo generico de ADR-0006, no hace falta fusionarlas.
net::BackendClient portonBackendClient(secrets::kBackendUrl, secrets::kDeviceToken);
constexpr uint32_t kPortonPollIntervalMs = 1000;

// El GET HTTPS del porton vive en una tarea aparte para no abrir huecos de
// cientos de milisegundos en la captura del bus de alarma. La tarea entrega
// el id al loop principal y espera su confirmacion: la transmision RF y el
// cooldown siguen teniendo un unico dueño y nunca se ejecutan en paralelo
// con el pulsador local.
QueueHandle_t portonCommandQueue = nullptr;
QueueHandle_t portonCommandAckQueue = nullptr;
struct PortonCommand {
  uint32_t id;
  uint32_t expiresAtMs;
};

struct ZoneStatus {
  bool zones[xanaes::kZoneCount];
  float temperaturaC;
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

void runTransmit() {
  logger::info("main", "transmitiendo trama Garen");
  led.write(true);
  rfTransmitter.send(kGarenCode, kGarenBitCount, kGarenRepetitions);
  led.write(false);
  logger::info("main", "transmision terminada");
}

// El ESP32 como control remoto: apretar el pulsador local dispara la trama.
// El flanco lo captura la interrupcion (ver onTriggerButtonPressed), no una
// lectura de nivel aca -- evita perder la pulsacion si el loop() esta
// bloqueado en pollStatusCycle() en el momento exacto del apriete. El rebote
// mecanico del contacto puede disparar la interrupcion varias veces por una
// sola pulsacion real, pero como solo prende un flag (idempotente) y el
// cooldown bloquea reenvios, no hace falta debounce aparte.
void pollTriggerButton() {
  if (!triggerButtonEdgePending) return;
  triggerButtonEdgePending = false;

  const uint32_t now = millis();
  if (now - lastTriggerMs >= kTriggerCooldownMs) {
    runTransmit();
    lastTriggerMs = millis();
  } else {
    logger::warn("main", "pulsacion ignorada: en cooldown");
  }
}

// Consume en el loop principal los comandos que obtuvo la tarea de red. Esta
// funcion no hace I/O de red: termina rapido y deja arrancar inmediatamente
// la siguiente ventana de captura del bus.
void pollPortonCommand() {
  if (portonCommandQueue == nullptr || portonCommandAckQueue == nullptr) return;

  PortonCommand command{};
  if (xQueueReceive(portonCommandQueue, &command, 0) != pdTRUE) return;

  // Mismo criterio que pollTriggerButton(): un comando que llega en cooldown
  // se descarta, no se encola para mas tarde -- se confirma igual para que
  // no vuelva a aparecer en el proximo poll.
  const uint32_t now = millis();
  if (static_cast<int32_t>(now - command.expiresAtMs) >= 0 || WiFi.status() != WL_CONNECTED) {
    logger::warn("main", "orden vencida o sin WiFi: descartada sin transmitir");
    // Desbloquear la tarea, sin confirmar una transmision que no ocurrio.
    const uint32_t discardedId = 0;
    xQueueOverwrite(portonCommandAckQueue, &discardedId);
    return;
  }
  if (now - lastTriggerMs < kTriggerCooldownMs) {
    logger::warn("main", "comando del backend ignorado: en cooldown");
    const uint32_t discardedId = 0;
    xQueueOverwrite(portonCommandAckQueue, &discardedId);
    return;
  } else {
    runTransmit();
    lastTriggerMs = millis();
  }

  xQueueOverwrite(portonCommandAckQueue, &command.id);
}

void pollPortonCommandTask(void*) {
  for (;;) {
    if (WiFi.status() == WL_CONNECTED) {
      const net::PendingCommand command = portonBackendClient.pollPendingCommand();
      if (command.present && command.tipo == "activar") {
        const uint32_t commandId = command.id;
        const PortonCommand queued{commandId, command.expiresAtMs};
        xQueueSend(portonCommandQueue, &queued, portMAX_DELAY);

        // No consultar de nuevo hasta que el loop haya transmitido o
        // descartado por cooldown. Asi el mismo comando no se entrega dos
        // veces mientras todavia esta siendo procesado.
        uint32_t processedId = 0;
        xQueueReceive(portonCommandAckQueue, &processedId, portMAX_DELAY);
        if (processedId == commandId) {
          portonBackendClient.acknowledge(commandId);
        }
      }
    }

    vTaskDelay(pdMS_TO_TICKS(kPortonPollIntervalMs));
  }
}

// No bloquea para siempre si el WiFi no esta disponible: captura manual,
// boton local y comandos por serial tienen que seguir andando sin red.
// Mismo criterio que firmware/src/main.cpp.
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
    logger::warn("main", "WiFi no conecto - sigue captura/serial/boton local, sin backend");
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

bool reportZoneStatus(const ZoneStatus& status) {
  String json = "{\"zonas\":[";
  for (uint8_t i = 0; i < xanaes::kZoneCount; ++i) {
    if (i > 0) json += ",";
    json += status.zones[i] ? "true" : "false";
  }
  json += "],\"temperaturaC\":" + String(status.temperaturaC, 1) + "}";

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

  // Abrir la conexion al arrancar para que el primer cambio de zona no tenga
  // que pagar el handshake TLS completo.
  keepConnectionWarm();

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

      if (WiFi.status() == WL_CONNECTED && reportZoneStatus(pending)) {
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

  // El "cambio" que decide si vale la pena un reporte sigue siendo solo de
  // zonas: la temperatura va de paso en el mismo JSON (ver ADR-0009), pero no
  // debe disparar un reporte por si sola -- para eso esta el heartbeat de
  // pollTemperatureHeartbeat().
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

  status.temperaturaC = temperatureRead();
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
  lastQueuedStatus.temperaturaC = temperatureRead();
  xQueueOverwrite(zoneStatusQueue, &lastQueuedStatus);
}

// temperatureRead() es el sensor interno del die del ESP32 -- no documentado
// oficialmente por Espressif ni calibrado de fabrica (pensado para calibrar
// el sensor Hall), y se distorsiona con la actividad de radio propia del
// chip. Sirve como indicador de tendencia relativa, no como temperatura
// ambiente real del gabinete -- para eso hace falta un sensor externo
// (DS18B20/NTC) que todavia no esta instalado.
//
// El reporte de zonas solo sale cuando una zona cambia (puede haber horas de
// diferencia entre uno y otro), asi que sin este heartbeat la temperatura
// mostrada en la pagina quedaria pegada al valor del ultimo evento en vez de
// reflejar la tendencia termica real durante un dia caluroso.
constexpr uint32_t kTempHeartbeatMs = 15 * 60 * 1000;
uint32_t lastTempHeartbeatMs = 0;

void pollTemperatureHeartbeat() {
  if (!hasLastQueuedStatus) return;
  if (zoneStatusQueue == nullptr) return;

  const uint32_t now = millis();
  if (now - lastTempHeartbeatMs < kTempHeartbeatMs) return;
  lastTempHeartbeatMs = now;

  lastQueuedStatus.temperaturaC = temperatureRead();
  xQueueOverwrite(zoneStatusQueue, &lastQueuedStatus);
}

// Ciclo automatico de estado: corre solo, sin intervencion, en paralelo a
// los comandos manuales por serial ('c'/'s') y al control del porton. Se
// salta a si mismo mientras haya una captura manual en curso -- RfReceiver no
// soporta dos sesiones de captura superpuestas.
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
    case 't':
      runTransmit();
      lastTriggerMs = millis();  // el cooldown tambien aplica al comando serial
      break;
    case '\n':
    case '\r':
      break;  // fin de linea del monitor serie, no es una tecla
    default:
      break;
  }
}

}  // namespace

void setup() {
  logger::begin(115200);
  led.begin();
  triggerButton.begin();
  // FALLING porque el pulsador es activo en bajo (pull-up interno, el boton
  // lleva el pin a GND). attachInterrupt() en vez de RfReceiver: ahi hace
  // falta timestamp y buffer de flancos, aca solo un flag booleano.
  attachInterrupt(digitalPinToInterrupt(kTriggerButtonPin), onTriggerButtonPressed, FALLING);
  rfTransmitter.begin();
  connectWiFi();

  portonCommandQueue = xQueueCreate(1, sizeof(PortonCommand));
  portonCommandAckQueue = xQueueCreate(1, sizeof(uint32_t));
  if (portonCommandQueue == nullptr || portonCommandAckQueue == nullptr ||
      xTaskCreate(pollPortonCommandTask, "porton-poll", 8192, nullptr, 1, nullptr) != pdPASS) {
    logger::warn("main", "no se pudo iniciar la tarea de comandos del porton");
  }

  zoneStatusQueue = xQueueCreate(1, sizeof(ZoneStatus));
  if (zoneStatusQueue == nullptr ||
      xTaskCreate(reportZoneStatusTask, "zone-report", 8192, nullptr, 1, nullptr) != pdPASS) {
    logger::warn("main", "no se pudo iniciar la tarea de reporte de zonas");
  }

  // A diferencia del porton (ventana fija de captura), esta sesion es
  // explicita y sin duracion predefinida: no sabemos cuanto tarda alguien en
  // caminar hasta el teclado real y apretar la tecla. 'c' arranca, 's' para.
  logger::info("main", "listo - 'c' arranca captura de DATO, 's' la para y vuelca el CSV");
  logger::info("main", "boton local (GPIO4), la app, o 't' por serial abren el porton");
  logger::info("main", "monitoreando estado de zonas en ventanas de 200ms");
  logger::info("main", "'r' reenvia el ultimo estado (diagnostico de latencia de red)");
  logger::info("main", "temperatura interna del ESP32 se reporta junto al estado de zonas");
}

void loop() {
  pollSerialCommand();
  pollHeartbeat();
  pollTriggerButton();
  pollPortonCommand();
  pollStatusCycle();
  pollTemperatureHeartbeat();
  delay(10);
}
