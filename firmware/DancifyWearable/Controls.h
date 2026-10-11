#pragma once
#include <stdint.h>

namespace dancify {
class Rotary {
  bool ready = false;
  int32_t filteredQ8 = 0, anchor = 0;
  uint32_t lastStep = 0;
 public:
  static constexpr int STEP_COUNTS = 180;
  void reset() { ready = false; }
  // Limited-travel analog sensor: no wrap and no automatic endpoint repeat.
  int update(int raw, uint32_t now) {
    if (!ready) {
      ready = true; filteredQ8 = raw * 256; anchor = raw; lastStep = now;
      return 0;
    }
    filteredQ8 += (raw * 256 - filteredQ8) / 4;
    const int filtered = filteredQ8 / 256;
    const int delta = filtered - anchor;
    if (now - lastStep < 80) return 0;
    if (delta >= STEP_COUNTS || delta <= -STEP_COUNTS) {
      anchor = filtered; lastStep = now;
      return delta > 0 ? 1 : -1;
    }
    return 0;
  }
};

enum ButtonEvent : uint8_t { NONE = 0, DOWN = 1, UP = 2, CLICK = 4, HOLD = 8 };
class Button {
  bool raw = false, stable = false, armed = false, held = false;
  uint32_t changedAt = 0, pressedAt = 0;
 public:
  void reset(bool pressed, uint32_t now) {
    raw = stable = pressed; armed = held = false; changedAt = pressedAt = now;
  }
  uint8_t update(bool pressed, uint32_t now) {
    uint8_t events = NONE;
    if (pressed != raw) { raw = pressed; changedAt = now; }
    if (raw != stable && now - changedAt >= 30) {
      stable = raw;
      if (stable) { armed = true; held = false; pressedAt = changedAt; events |= DOWN; }
      else {
        events |= UP;
        if (armed && !held) events |= changedAt - pressedAt < 500 ? CLICK : HOLD;
        armed = false;
      }
    }
    // Do not turn a short release into a hold while release debounce runs.
    if (stable && raw && armed && !held && now - pressedAt >= 500) {
      held = true; events |= HOLD;
    }
    return events;
  }
};
}  // namespace dancify
