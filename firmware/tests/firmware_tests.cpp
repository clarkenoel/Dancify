#include <assert.h>
#include <stdio.h>
#include "../DancifyWearable/FeedbackEngine.h"
#include "../DancifyWearable/Controls.h"
using namespace dancify;

static void configure(FeedbackEngine &e, int64_t now = 0) {
  assert(e.command("RUN:0", now));
  assert(e.command("BPM:120", now));
  assert(e.command("BEAT:0.5", now));
  assert(e.command("RUN:1", now));
}
static void feed(LineDecoder &d, FeedbackEngine &e, const char *s, int64_t now = 0) {
  for (; *s; ++s) d.feed(*s, e, now);
}
int main() {
  int passed = 0;
  {
    FeedbackEngine e;
    assert(e.tick(0) == 0 && !e.running);
    assert(!e.command("RUN:1", 0));
    e.command("BPM:120", 0); assert(e.tick(1000) == 0);
    assert(!e.command("RUN:1", 0));
    e.command("BEAT:0.5", 0); assert(e.tick(1000) == 0);
    e.command("RUN:1", 1000);
    assert(e.tick(500999) == 0); assert(e.tick(501000) != 0);
    assert(e.tick(540999) != 0); assert(e.tick(541000) == 0);
    assert(e.tick(1001000) != 0); ++passed;
  }
  {
    FeedbackEngine e; configure(e);
    const char *invalid[] = {"BPM:0", "BPM:-1", "BPM:120junk", "BPM:2147483648",
      "BEAT:nan", "BEAT:inf", "BEAT:-0.1", "BEAT:1.2.3", "BEAT:.", "RUN:2",
      "SYNC:", "BPM 120", "STOP", "TONE:0", "TONE:880x", "HIT:2"};
    for (const char *s : invalid) {
      assert(!e.command(s, 0));
      assert(e.running && e.bpm == 120 && e.beatDelay == 500000);
    }
    ++passed;
  }
  {
    FeedbackEngine e; configure(e); e.command("HIT:1", 500000);
    assert(e.tick(500000) != 0);
    e.command("RUN:0", 500001); assert(e.tick(500001) == 0);
    assert(!e.command("RUN:1", 500001));
    e.command("BPM:120", 500001); assert(!e.command("RUN:1", 500001));
    e.command("BEAT:0", 500001); assert(e.command("RUN:1", 500001));
    assert(e.tick(500001) != 0); ++passed;
  }
  {
    FeedbackEngine e; configure(e);
    assert(e.tick(15000000) == 0 && !e.running);
    e.command("SYNC:0.5", 15000000);
    assert(!e.command("RUN:1", 15000000));
    configure(e, 20000000); e.command("SYNC:0.5", 25000000);
    e.tick(39999999); assert(e.running);
    e.tick(40000000); assert(!e.running); ++passed;
  }
  {
    FeedbackEngine e; configure(e);
    e.command("SYNC:0.02", 0);  // Nearest equivalent beat is +20 ms away.
    assert(e.nextBeat == 500000 && e.tick(20000) == 0);
    assert(e.tick(500000) != 0);
    assert(e.nextBeat == 1002000); // Nearest grid: +20 ms, capped to +2 ms/beat.
    assert(e.tick(540000) == 0);
    assert(e.tick(1000000) == 0);
    assert(e.tick(1002000) != 0); ++passed;
  }
  {
    FeedbackEngine e; configure(e);
    assert(e.tick(2300000) == 0);  // Skip stale beat envelopes.
    assert(e.nextBeat == 2500000);
    assert(e.tick(2500000) != 0); ++passed;
  }
  {
    FeedbackEngine e; e.command("HIT:1", 0); assert(e.tick(0) == 0);
    e.command("TONE:880", 0); assert(e.tick(0) == 880);
    assert(e.tick(79999) == 880 && e.tick(80000) == 0);
    configure(e); e.command("HIT:1", 1000);
    assert(e.tick(1000) == 2400); assert(e.tick(21000) == 0);
    assert(e.tick(41000) == 2400); assert(e.tick(61000) == 0);
    assert(e.tick(81000) == 2400); assert(e.tick(101000) == 0);
    ++passed;
  }
  {
    FeedbackEngine e; LineDecoder d;
    feed(d, e, "RUN:0\nBP"); assert(!e.hasBpm);
    feed(d, e, "M:120\r\nBEAT:0.5\nRUN:1\n"); assert(e.running);
    e.stop();
    for (int i = 0; i < 80; ++i) d.feed('x', e, 0);
    feed(d, e, "BPM:99\nBEAT:0\nRUN:1\n"); assert(!e.running && !e.hasBpm);
    feed(d, e, "BPM:90\nRUN:1\n"); assert(e.running && e.bpm == 90);
    e.stop(); feed(d, e, "BPM:"); d.feed('\0', e, 0);
    feed(d, e, "120\n"); assert(!e.hasBpm);
    d.discardUntilNewline(); feed(d, e, "BPM:120\n"); assert(!e.hasBpm);
    feed(d, e, "BPM:120\n"); assert(e.hasBpm); ++passed;
  }
  {
    FeedbackEngine e; LineDecoder d;
    feed(d, e, "BPM:12"); e.stop(); d.reset(); // New BLE connection.
    feed(d, e, "0\nBEAT:0\nRUN:1\n"); assert(!e.running);
    configure(e); assert(e.running); e.stop(); assert(e.tick(0) == 0); ++passed;
  }
  {
    Rotary r; assert(r.update(2000, 0) == 0);
    for (uint32_t t = 10; t < 5000; t += 10) assert(r.update(2000 + (t % 30) - 10, t) == 0);
    int forward = 0, reverse = 0;
    for (uint32_t t = 5000; t < 6000; t += 10) forward += r.update(2500, t) > 0;
    assert(forward >= 1 && forward <= 3);
    for (uint32_t t = 6000; t < 7000; t += 10) reverse += r.update(1900, t) < 0;
    assert(reverse >= 1 && reverse <= 3); ++passed;
  }
  {
    Rotary r; r.update(4095, 0);
    for (uint32_t t = 10; t < 5000; t += 10) assert(r.update(4095, t) == 0);
    r.reset(); assert(r.update(0, 5000) == 0); // No movement replay on reconnect.
    for (uint32_t t = 5010; t < 6000; t += 10) assert(r.update(0, t) == 0);
    ++passed;
  }
  {
    Button b; b.reset(false, 0);
    assert(b.update(true, 10) == NONE); assert(b.update(false, 15) == NONE);
    assert(b.update(true, 20) == NONE); assert(b.update(true, 50) == DOWN);
    assert(b.update(false, 200) == NONE);
    assert(b.update(false, 230) == (UP | CLICK));
    assert(b.update(false, 500) == NONE); ++passed;
  }
  {
    Button b; b.reset(false, 0);
    b.update(true, 10); assert(b.update(true, 40) == DOWN);
    assert(b.update(true, 510) == HOLD); assert(b.update(true, 800) == NONE);
    b.update(false, 900); assert(b.update(false, 930) == UP);
    b.reset(true, 1000); b.update(false, 1100); assert(b.update(false, 1130) == UP);
    ++passed;
  }
  {
    Button b; const uint32_t start = 0xFFFFFF00U;
    b.reset(false, start); b.update(true, start + 10);
    assert(b.update(true, start + 40) == DOWN);
    assert(b.update(true, start + 510) == HOLD); ++passed;
  }
  {
    FeedbackEngine e; configure(e);
    e.command("SYNC:0.48", 0); // -20 ms phase correction.
    assert(e.tick(999000) == 0);
    assert(e.nextBeat > 999000); // Negative slew must not schedule in the past.
    assert(e.tick(1000000) == 0); ++passed;
  }
  {
    FeedbackEngine e; configure(e);
    int beats = 0; bool wasOn = false;
    for (int64_t t = 0; t <= 60000000; t += 1000) {
      if (t && t % 5000000 == 0) assert(e.command("SYNC:0", t));
      const bool on = e.tick(t) != 0;
      if (on && !wasOn) { ++beats; assert(t % 500000 == 0); }
      wasOn = on;
    }
    assert(beats == 120 && e.running); ++passed;
  }
  {
    Button b; b.reset(false, 0);
    b.update(true, 10); b.update(true, 40);
    b.update(false, 509); assert(b.update(false, 520) == NONE);
    assert(b.update(false, 539) == (UP | CLICK)); ++passed;
  }
  printf("PASS: %d firmware invariant groups\n", passed);
}
