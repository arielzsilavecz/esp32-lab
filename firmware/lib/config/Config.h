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

// FS1000A. GPIO32 es salida completa (34/35/36/39 son solo entrada) y no es
// pin de strapping ni de flash. Ver docs/hardware/fs1000a-wiring.md.
constexpr uint8_t kRfTransmitterPin = 32;

// Boton BOOT del DevKit. Es pin de strapping (tiene que estar en alto durante
// el reset para bootear normal), pero una vez arrancado se puede leer como
// entrada comun. Activo en bajo: el boton lo lleva a GND.
//
// No se usa EN: EN es el reset del chip, y disparar la transmision desde ahi
// significaria activar el porton en cada arranque -- al enchufar el USB, al
// volver la luz, o ante cualquier reset espureo.
constexpr uint8_t kTriggerButtonPin = 0;

// El control es de boton unico con ciclo abrir -> parar -> cerrar, asi que una
// segunda pulsacion accidental frena la hoja a mitad de camino en vez de
// repetir la orden. El cooldown es un requisito funcional, no una proteccion
// contra spam. Ver docs/captures/esp32-tx-generada-2026-08-18.md.
constexpr uint32_t kTriggerCooldownMs = 3000;

}  // namespace config
