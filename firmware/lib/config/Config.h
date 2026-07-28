#pragma once

#include <cstdint>

// Configuración centralizada: pines y constantes que hoy solo usa el bring-up
// (blink) pero que van a crecer con las próximas etapas (RF, etc.).
namespace config {

constexpr uint8_t kLedPin = 2;
constexpr uint32_t kBlinkIntervalMs = 500;
constexpr unsigned long kSerialBaudRate = 115200;

}  // namespace config
