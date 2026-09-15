#include "BackendClient.h"

namespace net {

BackendClient::BackendClient(const char* baseUrl, const char* deviceToken)
    : baseUrl_(baseUrl), deviceToken_(deviceToken) {
  secureClient_.setInsecure();
  http_.setReuse(true);
}

namespace {

// Parsers minimos para un shape de respuesta fijo y controlado por nosotros
// del lado del backend ({"id":N,"tipo_comando":"..."}) -- no manejan escapes
// ni JSON arbitrario a proposito, para no traer una libreria entera por dos
// campos. Tolerantes a un espacio despues de ":" (Express puede indentar en
// desarrollo).
long extractNumberField(const String& json, const char* field) {
  String needle = String("\"") + field + "\":";
  int start = json.indexOf(needle);
  if (start < 0) return -1;
  start += needle.length();
  while (start < (int)json.length() && json[start] == ' ') ++start;

  int end = start;
  while (end < (int)json.length() && (isDigit(json[end]) || json[end] == '-')) {
    ++end;
  }
  if (end == start) return -1;
  return json.substring(start, end).toInt();
}

String extractStringField(const String& json, const char* field) {
  String needle = String("\"") + field + "\":";
  int start = json.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();
  while (start < (int)json.length() && json[start] == ' ') ++start;
  if (start >= (int)json.length() || json[start] != '"') return "";
  ++start;

  int end = json.indexOf('"', start);
  if (end < 0) return "";
  return json.substring(start, end);
}

}  // namespace

PendingCommand BackendClient::pollPendingCommand() {
  const uint32_t requestStartMs = millis();
  http_.begin(secureClient_, baseUrl_ + "/api/device/comando-pendiente");
  http_.addHeader("Authorization", "Bearer " + deviceToken_);

  const int status = http_.GET();

  PendingCommand result{false, 0, "", 0};
  if (status == 200) {
    const String body = http_.getString();
    const long id = extractNumberField(body, "id");
    const long ttlMs = extractNumberField(body, "ttl_ms");
    // Restar toda la duracion del request es conservador: una respuesta
    // demorada nunca rejuvenece una orden vencida.
    if (id >= 0 && ttlMs > 0 && ttlMs <= 5000 &&
        millis() - requestStartMs < static_cast<uint32_t>(ttlMs)) {
      result.present = true;
      result.id = static_cast<uint32_t>(id);
      result.tipo = extractStringField(body, "tipo_comando");
      result.expiresAtMs = requestStartMs + static_cast<uint32_t>(ttlMs);
    }
  }
  // status == 204: sin comando pendiente. Cualquier otro status (red caida,
  // 401, 500...) tambien cae en "sin comando" acá -- no hay una accion
  // distinta y útil que tomar todavia si falla la request en sí.

  http_.end();
  return result;
}

bool BackendClient::acknowledge(uint32_t commandId) {
  http_.begin(secureClient_, baseUrl_ + "/api/device/comando/" + String(commandId) + "/consumido");
  http_.addHeader("Authorization", "Bearer " + deviceToken_);

  const int status = http_.POST("");
  if (status > 0) http_.getString();  // drena el body para poder reusar el socket
  http_.end();
  return status == 200;
}

bool BackendClient::ping() {
  http_.begin(secureClient_, baseUrl_ + "/api/device/ping");
  http_.addHeader("Authorization", "Bearer " + deviceToken_);

  const int status = http_.GET();
  if (status > 0) http_.getString();  // drena el body para poder reusar el socket
  http_.end();
  return status == 200;
}

bool BackendClient::reportEstado(const String& estadoJson) {
  http_.begin(secureClient_, baseUrl_ + "/api/device/estado");
  http_.addHeader("Authorization", "Bearer " + deviceToken_);
  http_.addHeader("Content-Type", "application/json");

  const int status = http_.POST("{\"estado\":" + estadoJson + "}");
  if (status > 0) http_.getString();  // drena el body para poder reusar el socket
  http_.end();
  return status == 200;
}

}  // namespace net
