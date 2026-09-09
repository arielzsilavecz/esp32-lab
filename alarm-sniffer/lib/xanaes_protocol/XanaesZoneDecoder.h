#pragma once

#include <cstdint>

#include "RfReceiver.h"

namespace xanaes {

constexpr uint8_t kZoneCount = 6;

// Busca la trama de reporte de estado del panel (145 símbolos de datos) en
// una captura ya parada (ver RfReceiver::stopCapture) y decodifica en
// `zonesOut` el estado de las 6 zonas de la ÚLTIMA ocurrencia encontrada en
// la ventana (la trama no es periódica: se emite un par de veces cada vez
// que una zona cambia de estado, con huecos de varios segundos en el medio
// si nada cambia -- si hubo más de un cambio en la misma ventana, importa
// quedarse con el más reciente). Devuelve false si no apareció ninguna en la
// ventana capturada -- normal si no cambió nada, se reintenta en la próxima.
//
// A diferencia de tools/analyze_capture.py, acá no hace falta clustering
// adaptativo ni detección genérica de bordes de trama: el protocolo ya está
// entendido (docs/hardware/xanaes-dato-protocol.md), así que se usan los
// umbrales fijos ya medidos.
bool decodeZoneStatus(const rf::RfReceiver& capture, bool zonesOut[kZoneCount]);

}  // namespace xanaes
