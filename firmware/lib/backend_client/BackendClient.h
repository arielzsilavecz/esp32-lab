#pragma once

#include <Arduino.h>
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

 private:
  String baseUrl_;
  String deviceToken_;
};

}  // namespace net
