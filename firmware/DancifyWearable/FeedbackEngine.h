#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

// Hardware-independent protocol and envelope scheduler. Times are microseconds.
namespace dancify {
class FeedbackEngine {
 public:
  bool running = false;
  bool hasBpm = false, hasBeat = false;
  uint32_t bpm = 0;
  int64_t period = 500000, nextBeat = 0, syncDeadline = 0;
  int64_t beatDelay = 0, correction = 0;
  int64_t beatEnd = 0, toneEnd = 0, hitStart = -1;
  uint32_t toneHz = 880;

  void stop() {
    running = hasBpm = hasBeat = false;
    bpm = 0; correction = 0;
    beatEnd = toneEnd = 0; hitStart = -1;
  }
  static bool positiveInteger(const char *s, uint32_t &value) {
    if (!*s) return false;
    uint32_t n = 0;
    for (; *s; ++s) {
      if (*s < '0' || *s > '9') return false;
      const uint32_t digit = *s - '0';
      if (n > (2147483647U - digit) / 10U) return false;
      n = n * 10U + digit;
    }
    if (!n) return false;
    value = n; return true;
  }
  static bool seconds(const char *s, int64_t &us) {
    // Strict decimal syntax: no signs, NaN, infinity, whitespace or suffixes.
    bool digit = false, dot = false;
    for (const char *p = s; *p; ++p) {
      if (*p >= '0' && *p <= '9') digit = true;
      else if (*p == '.' && !dot) dot = true;
      else return false;
    }
    if (!digit) return false;
    const double v = strtod(s, nullptr);
    if (!isfinite(v) || v < 0 || v > 86400.0) return false;
    us = static_cast<int64_t>(v * 1000000.0 + 0.5);
    return true;
  }
  bool command(const char *line, int64_t now) {
    uint32_t number; int64_t delay;
    if (!strcmp(line, "RUN:0")) { stop(); return true; }
    if (!strcmp(line, "RUN:1")) {
      if (!hasBpm || !hasBeat) return false;
      if (!running) {
        running = true; nextBeat = now + beatDelay;
        syncDeadline = now + 15000000; correction = 0;
      }
      return true;
    }
    if (!strncmp(line, "BPM:", 4) && positiveInteger(line + 4, number)) {
      bpm = number; period = 60000000LL / bpm;
      if (period < 1) period = 1;
      hasBpm = true; return true;
    }
    if (!strncmp(line, "BEAT:", 5) && seconds(line + 5, delay)) {
      beatDelay = delay; hasBeat = true; return true;
    }
    if (!strncmp(line, "SYNC:", 5) && seconds(line + 5, delay)) {
      if (running) {
        syncDeadline = now + 15000000;
        // Compare the nearest beat on the two grids, not their beat numbers.
        correction = (now + delay - nextBeat) % period;
        if (correction > period / 2) correction -= period;
        if (correction < -period / 2) correction += period;
      }
      return true;
    }
    if (!strcmp(line, "HIT:1")) {
      if (running && (hitStart < 0 || now - hitStart >= 100000)) hitStart = now;
      return true;
    }
    if (!strncmp(line, "TONE:", 5) && positiveInteger(line + 5, number)) {
      // Audible piezo range; reject unrepresentable requests without mutation.
      if (number > 20000) return false;
      toneHz = number; toneEnd = now + 80000; return true;
    }
    return false;
  }
  uint32_t tick(int64_t now) {
    if (running && now >= syncDeadline) stop();
    if (running && now >= nextBeat) {
      const int64_t width = period / 5 < 40000 ? period / 5 : 40000;
      // Skip old envelopes after scheduling suspension; never replay a burst.
      const int64_t late = now - nextBeat;
      beatEnd = late < width ? nextBeat + width : 0;
      nextBeat += (late / period + 1) * period;
      int64_t limit = period / 20;
      if (limit > 2000) limit = 2000;
      const int64_t shift = correction < -limit ? -limit : correction > limit ? limit : correction;
      nextBeat += shift; correction -= shift;
      if (nextBeat <= now) nextBeat += period;
    }
    if (hitStart >= 0) {
      const int64_t elapsed = now - hitStart;
      if (elapsed >= 100000) hitStart = -1;
      else return elapsed % 40000 < 20000 ? 2400 : 0;
    }
    if (now < toneEnd) return toneHz;
    return running && now < beatEnd ? 1800 : 0;
  }
};

class LineDecoder {
  char line[64] = {};
  size_t used = 0;
  bool dropping = false;
 public:
  void reset() { used = 0; dropping = false; }
  void discardUntilNewline() { used = 0; dropping = true; }
  void feed(char c, FeedbackEngine &engine, int64_t now) {
    if (c == '\n') {
      if (!dropping) {
        if (used && line[used - 1] == '\r') --used;
        line[used] = 0; engine.command(line, now);
      }
      reset();
    } else if (!dropping) {
      if ((static_cast<unsigned char>(c) < 32 && c != '\r') ||
          static_cast<unsigned char>(c) > 126 || used >= sizeof(line) - 1) {
        discardUntilNewline();
      } else line[used++] = c;
    }
  }
};
}  // namespace dancify
