#pragma once

#include <cstdint>

// Configuración centralizada: pines y constantes que hoy solo usa el bring-up
// (blink) pero que van a crecer con las próximas etapas (RF, etc.).
namespace config {

constexpr uint8_t kLedPin = 2;
constexpr uint32_t kBlinkIntervalMs = 500;
constexpr unsigned long kSerialBaudRate = 115200;

// Ver docs/hardware/mx05v-wiring.md para el cableado (divisor de tensión 5V->3.3V).
constexpr uint8_t kRfReceiverPin = 34;
constexpr uint32_t kCaptureWindowMs = 5000;

}  // namespace config
