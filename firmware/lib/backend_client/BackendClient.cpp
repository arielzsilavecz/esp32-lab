#include "BackendClient.h"

#include <HTTPClient.h>
#include <WiFiClientSecure.h>

namespace net {

BackendClient::BackendClient(const char* baseUrl, const char* deviceToken)
    : baseUrl_(baseUrl), deviceToken_(deviceToken) {}

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
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, baseUrl_ + "/api/device/comando-pendiente");
  http.addHeader("Authorization", "Bearer " + deviceToken_);

  const int status = http.GET();

  PendingCommand result{false, 0, ""};
  if (status == 200) {
    const String body = http.getString();
    const long id = extractNumberField(body, "id");
    if (id >= 0) {
      result.present = true;
      result.id = static_cast<uint32_t>(id);
      result.tipo = extractStringField(body, "tipo_comando");
    }
  }
  // status == 204: sin comando pendiente. Cualquier otro status (red caida,
  // 401, 500...) tambien cae en "sin comando" acá -- no hay una accion
  // distinta y útil que tomar todavia si falla la request en sí.

  http.end();
  return result;
}

bool BackendClient::acknowledge(uint32_t commandId) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, baseUrl_ + "/api/device/comando/" + String(commandId) + "/consumido");
  http.addHeader("Authorization", "Bearer " + deviceToken_);

  const int status = http.POST("");
  http.end();
  return status == 200;
}

}  // namespace net
