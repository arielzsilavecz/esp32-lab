#pragma once

#include <cstdint>

namespace logger {

enum class Level : uint8_t { Debug, Info, Warn, Error };

// Inicializa Serial al baudrate dado y fija el nivel mínimo que se imprime.
void begin(unsigned long baudRate, Level minLevel = Level::Info);

void debug(const char* tag, const char* message);
void info(const char* tag, const char* message);
void warn(const char* tag, const char* message);
void error(const char* tag, const char* message);

}  // namespace logger
