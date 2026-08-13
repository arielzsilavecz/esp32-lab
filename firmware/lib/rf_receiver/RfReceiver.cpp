#include "RfReceiver.h"

#include <Arduino.h>

namespace rf {

RfReceiver::RfReceiver(uint8_t pin) : pin_(pin), writeIndex_(0), overflowed_(false) {}

void RfReceiver::startCapture() {
  writeIndex_ = 0;
  overflowed_ = false;
  pinMode(pin_, INPUT);
  attachInterruptArg(digitalPinToInterrupt(pin_), onEdgeTrampoline, this, CHANGE);
}

void RfReceiver::stopCapture() {
  detachInterrupt(digitalPinToInterrupt(pin_));
}

size_t RfReceiver::count() const { return writeIndex_; }

bool RfReceiver::overflowed() const { return overflowed_; }

const Edge& RfReceiver::edgeAt(size_t index) const { return buffer_[index]; }

void RfReceiver::onEdgeTrampoline(void* self) {
  static_cast<RfReceiver*>(self)->onEdge();
}

void RfReceiver::onEdge() {
  const uint32_t now = micros();
  const bool level = digitalRead(pin_);
  if (writeIndex_ < kCapacity) {
    buffer_[writeIndex_].timestampUs = now;
    buffer_[writeIndex_].level = level;
    ++writeIndex_;
  } else {
    overflowed_ = true;
  }
}

}  // namespace rf
