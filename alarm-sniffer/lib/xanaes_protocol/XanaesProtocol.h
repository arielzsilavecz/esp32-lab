#pragma once

#include <cstdint>

namespace xanaes {

// Trama de una tecla del teclado Xanaes 610: 22 bits. Posiciones 0-10 y
// 18-21 fijas (idénticas en las 12 teclas, confirmado en sesiones de
// captura independientes), posiciones 11-17 el código de 7 bits de la
// tecla. Ver docs/hardware/xanaes-dato-protocol.md.
constexpr uint8_t kKeyFrameBitCount = 22;
constexpr uint32_t kKeyFramePrefix = 0b11010101010;  // 11 bits, posiciones 21-11
constexpr uint32_t kKeyFrameSuffix = 0b1101;         // 4 bits, posiciones 3-0

// Código de 7 bits por tecla (docs/hardware/xanaes-dato-protocol.md). El
// botón "casita" queda afuera a propósito: su función real no está
// confirmada y apretarlo dejó el panel en un estado no identificado durante
// la captura (ver docs/captures/xanaes-casita-2026-09-07.md) -- no hace
// falta para demostrar la capacidad de escritura sobre DATO.
inline int16_t keyCode(char key) {
  switch (key) {
    case '1': return 0b1010100;
    case '2': return 0b1010011;
    case '3': return 0b1010010;
    case '4': return 0b1001101;
    case '5': return 0b1001100;
    case '6': return 0b1001011;
    case '7': return 0b1001010;
    case '8': return 0b0110101;
    case '9': return 0b0110100;
    case '*': return 0b0110011;
    case '0': return 0b1010101;
    case '#': return 0b0110010;
    default: return -1;  // tecla desconocida o excluida a propósito
  }
}

// Arma la trama completa de 22 bits para una tecla: prefijo fijo (11) +
// código de la tecla (7) + sufijo fijo (4).
inline uint32_t buildKeyFrame(uint8_t code7bits) {
  return (kKeyFramePrefix << 11) | (static_cast<uint32_t>(code7bits) << 4) | kKeyFrameSuffix;
}

}  // namespace xanaes
