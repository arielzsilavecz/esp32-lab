#include "Logger.h"

#include <Arduino.h>

namespace logger {

namespace {

// static local en vez de variable de namespace: evita el orden de
// inicialización de estáticos globales (relevante si algún día algo loguea
// desde el constructor de un objeto global).
Level& minLevel() {
  static Level level = Level::Info;
  return level;
}

const char* levelName(Level level) {
  switch (level) {
    case Level::Debug: return "DEBUG";
    case Level::Info: return "INFO";
    case Level::Warn: return "WARN";
    case Level::Error: return "ERROR";
  }
  return "?";
}

void log(Level level, const char* tag, const char* message) {
  if (static_cast<uint8_t>(level) < static_cast<uint8_t>(minLevel())) return;
  Serial.printf("[%8lu][%s][%s] %s\n", millis(), levelName(level), tag, message);
}

}  // namespace

void begin(unsigned long baudRate, Level minimumLevel) {
  Serial.begin(baudRate);
  minLevel() = minimumLevel;
}

void debug(const char* tag, const char* message) { log(Level::Debug, tag, message); }
void info(const char* tag, const char* message) { log(Level::Info, tag, message); }
void warn(const char* tag, const char* message) { log(Level::Warn, tag, message); }
void error(const char* tag, const char* message) { log(Level::Error, tag, message); }

}  // namespace logger
