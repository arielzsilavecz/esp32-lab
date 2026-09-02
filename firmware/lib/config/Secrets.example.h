#pragma once

// Copiar a Secrets.h (gitignored) y completar. Nunca commitear Secrets.h.
//
// kDeviceToken sale de correr, del lado de backend/:
//   npm run seed dispositivo "Porton" porton
// (imprime el token una sola vez).

namespace secrets {

constexpr char kWifiSsid[] = "TU_RED_WIFI";
constexpr char kWifiPassword[] = "TU_PASSWORD_WIFI";

constexpr char kBackendUrl[] = "https://tu-app.up.railway.app";
constexpr char kDeviceToken[] = "TOKEN_IMPRESO_POR_NPM_RUN_SEED";

}  // namespace secrets
