#include "XanaesZoneDecoder.h"

namespace xanaes {

namespace {

// Los pulsos normales miden ~78-161us (ver xanaes-dato-protocol.md); los
// huecos entre tramas miden miles de us (~3900-5600us) o, en el silencio de
// fondo, ~125ms. Un umbral de 1ms separa ambos mundos con margen de sobra --
// no hace falta calcular una mediana adaptativa como hace el analizador de
// PC, el protocolo ya está entendido.
constexpr uint32_t kFrameGapThresholdUs = 1000;

// Punto medio entre los dos clusters de ancho de símbolo medidos (~80us y
// ~160us).
constexpr uint16_t kBitThresholdUs = 120;

constexpr uint8_t kStatusFrameDataEdges = 145;

// Posición (0-indexada, dentro de los símbolos de datos) del primer símbolo
// de la Zona 1. Cada zona ocupa 2 símbolos: "1,0" en reposo, "0,1" activada.
constexpr uint8_t kZoneBlockStart = 10;

bool symbolBit(uint32_t durationUs) {
  return durationUs >= kBitThresholdUs;
}

}  // namespace

bool decodeZoneStatus(const rf::RfReceiver& capture, bool zonesOut[kZoneCount]) {
  const size_t count = capture.count();
  if (count < 2) return false;

  size_t frameStart = 0;  // índice del último flanco de borde visto
  bool found = false;

  // Sigue recorriendo todo el buffer en vez de cortar en la primera trama de
  // 145 que encuentra: la trama de estado no es periódica, se emite (por lo
  // visto, dos veces seguidas) cada vez que una zona cambia -- si dentro de
  // la misma ventana de captura hubo más de un cambio, importa quedarse con
  // el último (el estado más reciente), no con el primero.
  for (size_t i = 1; i < count; ++i) {
    const uint32_t duration = capture.edgeAt(i).timestampUs - capture.edgeAt(i - 1).timestampUs;

    if (duration > kFrameGapThresholdUs) {
      frameStart = i;
      continue;
    }

    if (i - frameStart != kStatusFrameDataEdges) continue;

    // `i` es el último símbolo de una trama candidata de 145. Confirmar que
    // termina acá (el próximo flanco, si existe, es otro borde) antes de
    // confiar en el largo -- si la ventana de captura corta justo acá, se
    // acepta de todos modos: es una simplificación deliberada, un posible
    // falso positivo puntual no importa porque se vuelve a intentar en la
    // próxima ventana.
    const bool endsHere = (i + 1 >= count) ||
        (capture.edgeAt(i + 1).timestampUs - capture.edgeAt(i).timestampUs > kFrameGapThresholdUs);
    if (!endsHere) continue;

    for (uint8_t zone = 0; zone < kZoneCount; ++zone) {
      // +1 porque frameStart es el flanco de BORDE (el hueco de silencio
      // previo), no el primer símbolo de datos -- el primer símbolo de
      // datos está en frameStart+1 (posición 0 dentro de la trama).
      const size_t firstIndex = frameStart + 1 + kZoneBlockStart + 2 * zone;
      const size_t secondIndex = firstIndex + 1;
      const uint32_t firstDuration =
          capture.edgeAt(firstIndex).timestampUs - capture.edgeAt(firstIndex - 1).timestampUs;
      const uint32_t secondDuration =
          capture.edgeAt(secondIndex).timestampUs - capture.edgeAt(secondIndex - 1).timestampUs;

      // "0,1" = zona activada (ver docs/hardware/xanaes-dato-protocol.md).
      zonesOut[zone] = !symbolBit(firstDuration) && symbolBit(secondDuration);
    }
    found = true;
  }

  return found;
}

}  // namespace xanaes
