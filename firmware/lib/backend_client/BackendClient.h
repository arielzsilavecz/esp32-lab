#pragma once

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <cstdint>

namespace net {

struct PendingCommand {
  bool present;
  uint32_t id;
  String tipo;
};

// Cliente HTTPS del backend (ver backend/, ADR-0006). Asume que la conexion
// WiFi ya esta activa -- no la gestiona, esa es responsabilidad de quien
// arma la aplicacion (main.cpp), igual que RfReceiver no gestiona el pinMode
// de otros pines.
//
// TLS sin validar certificado (setInsecure()): decision consciente para el
// primer corte, no un descuido. Verificar la cadena real de Railway hoy es
// prematuro porque el backend todavia no esta deployado -- endurecerlo
// despues significa fijar el root CA correcto con setCACert() una vez que la
// URL de produccion exista.
class BackendClient {
 public:
  BackendClient(const char* baseUrl, const char* deviceToken);

  // Devuelve el comando pendiente mas viejo del dispositivo, si hay alguno.
  // Bloqueante (round-trip HTTPS): tipicamente bajo 1s con buena señal, pero
  // puede tardar mas con WiFi degradado.
  PendingCommand pollPendingCommand();

  // Marca un comando como consumido. Devuelve false si la request fallo o el
  // comando ya no existia/estaba consumido.
  bool acknowledge(uint32_t commandId);

  // Reporta el estado propio del dispositivo (direccion opuesta a
  // pollPendingCommand: el dispositivo empuja, no consulta). `estadoJson` es
  // el objeto JSON completo del campo "estado" ya armado por quien llama
  // (ej. {"zonas":[true,false,...]}) -- este cliente no sabe nada de su
  // contenido, solo lo transporta, igual que no interpreta tipo_comando.
  // Devuelve false si la request fallo.
  bool reportEstado(const String& estadoJson);

  // Request minima cuyo unico proposito es que el socket TLS no muera por
  // inactividad: el backend responde 200 con un body minimo y sin tocar la
  // base. Sirve solo si se llama mas seguido que el timeout de conexion
  // ociosa del hosting (60s en Railway, medido) -- ver ADR-0009. Devuelve
  // false si la request fallo.
  bool ping();

 private:
  String baseUrl_;
  String deviceToken_;
  WiFiClientSecure secureClient_;
  HTTPClient http_;
};

}  // namespace net
