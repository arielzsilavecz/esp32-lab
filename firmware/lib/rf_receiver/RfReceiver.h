#pragma once

#include <cstddef>
#include <cstdint>

#include <esp_attr.h>  // IRAM_ATTR

namespace rf {

// Un flanco crudo: timestamp absoluto (micros()) y el nivel resultante del
// pin después del cambio. La duración de un pulso se calcula después,
// restando timestamps de flancos consecutivos — no se calcula acá para
// mantener el trabajo dentro de la ISR al mínimo.
struct Edge {
  uint32_t timestampUs;
  bool level;
};

// Captura flancos de un pin digital por interrupción, sin decodificar nada.
//
// Uso: startCapture() -> esperar (el usuario aprieta el control remoto) ->
// stopCapture() -> leer con count()/edgeAt()/overflowed().
//
// No es seguro leer mientras la captura está activa: mientras la
// interrupción está enganchada, la ISR es la única dueña del buffer. Recién
// después de stopCapture() (que desactiva la interrupción) es seguro leer
// desde el loop principal sin secciones críticas.
class RfReceiver {
 public:
  // 2048 alcanzaba de sobra para una trama RF de 433MHz (~1200 flancos en 5s).
  // Se subió a 8192 al reusar esta clase para el bus DATO de una alarma
  // (alarm-sniffer/, ADR-0007): ese bus tiene trafico de fondo continuo
  // (polling del panel cada ~125ms, mas rafagas cortas cada ~250-375ms) que
  // llenaba 2048 antes de dar tiempo a caminar hasta el teclado y apretar una
  // tecla. Costo en RAM trivial en un ESP32 (~64KB de ~320KB disponibles) --
  // no afecta al porton, que nunca se acerco a llenar ni el limite viejo.
  static constexpr size_t kCapacity = 8192;

  explicit RfReceiver(uint8_t pin);

  void startCapture();
  void stopCapture();

  size_t count() const;
  bool overflowed() const;
  const Edge& edgeAt(size_t index) const;

 private:
  static void onEdgeTrampoline(void* self) IRAM_ATTR;
  void onEdge() IRAM_ATTR;

  uint8_t pin_;
  Edge buffer_[kCapacity];
  volatile size_t writeIndex_;
  volatile bool overflowed_;
};

}  // namespace rf
