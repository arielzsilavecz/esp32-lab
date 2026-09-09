#pragma once

// Copiar a Secrets.h (gitignored) y completar. Nunca commitear Secrets.h.
//
// kDeviceToken y kAlarmDeviceToken salen de correr, del lado de backend/:
//   npm run seed dispositivo "Porton" porton
//   npm run seed dispositivo "Alarma" alarma
// (cada uno imprime su token una sola vez). Este archivo lo comparten los
// dos proyectos PlatformIO (firmware/ y alarm-sniffer/, vía lib_extra_dirs)
// -- por eso el WiFi y la URL del backend son un solo par de constantes, no
// uno por proyecto.

namespace secrets {

constexpr char kWifiSsid[] = "TU_RED_WIFI";
constexpr char kWifiPassword[] = "TU_PASSWORD_WIFI";

constexpr char kBackendUrl[] = "https://tu-app.up.railway.app";
constexpr char kDeviceToken[] = "TOKEN_IMPRESO_POR_NPM_RUN_SEED_PORTON";
constexpr char kAlarmDeviceToken[] = "TOKEN_IMPRESO_POR_NPM_RUN_SEED_ALARMA";

}  // namespace secrets
