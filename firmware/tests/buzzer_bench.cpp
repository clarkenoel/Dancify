#include <assert.h>
#include <stdio.h>
#include "../DancifyWearable/FeedbackEngine.h"
using namespace dancify;

static void send(LineDecoder &decoder, FeedbackEngine &engine, const char *text, int64_t now) {
  for (; *text; ++text) decoder.feed(*text, engine, now);
}

int main() {
  puts("BUZZER SOFTWARE BENCH - production FeedbackEngine and LineDecoder");
  puts("Simulated microsecond clock; no physical GPIO or sound measurement.\n");
  const int tempos[] = {60, 120, 180};
  for (int bpm : tempos) {
    FeedbackEngine e; LineDecoder decoder;
    char configuration[96];
    snprintf(configuration, sizeof(configuration), "RUN:0\nBPM:%d\nBEAT:0.5\nRUN:1\n", bpm);
    send(decoder, e, configuration, 0);
    const int64_t interval = 60000000LL / bpm;
    int pulses = 0, completed = 0;
    int64_t lastStart = -1, pulseStart = -1;
    bool previous = false;
    printf("%d BPM: ", bpm);
    // 1 us resolution tests the scheduler's deadlines, not FreeRTOS latency.
    for (int64_t t = 0; t <= 2600000; ++t) {
      const bool on = e.tick(t) != 0;
      if (on && !previous) {
        if (lastStart >= 0) assert(t - lastStart == interval);
        else assert(t == 500000);
        lastStart = pulseStart = t; ++pulses;
        printf("%.3f ms ON; ", t / 1000.0);
      }
      if (!on && previous) { assert(t - pulseStart == 40000); ++completed; }
      previous = on;
    }
    assert(pulses == (2600000 - 500000) / interval + 1);
    assert(completed == pulses);
    printf("PASS (%lld us intervals, 40000 us pulse widths)\n", static_cast<long long>(interval));
  }
  {
    FeedbackEngine e; LineDecoder decoder;
    send(decoder, e, "RUN:0\nBPM:120\nBEAT:0\nRUN:1\n", 0);
    assert(e.tick(0));
    send(decoder, e, "RUN:0\n", 10000);
    assert(!e.tick(10000));
    for (int64_t t = 10001; t < 2000000; t += 1000) assert(!e.tick(t));
    puts("STOP during pulse: PASS (silent at same simulated timestamp, no later beats)");
  }
  {
    FeedbackEngine e; LineDecoder decoder;
    send(decoder, e, "RUN:0\nBPM:120\nBEAT:0.5\nRUN:1\nHIT:1\n", 0);
    int pulses = 0, releases = 0; bool previous = false;
    const int64_t starts[] = {0, 40000, 80000}, ends[] = {20000, 60000, 100000};
    for (int64_t t = 0; t <= 150000; ++t) {
      const bool on = e.tick(t) != 0;
      if (on && !previous) { assert(pulses < 3 && t == starts[pulses]); ++pulses; }
      if (!on && previous) { assert(releases < 3 && t == ends[releases]); ++releases; }
      previous = on;
    }
    assert(pulses == 3 && releases == 3);
    puts("HIT: PASS (ON 0-20 ms, 40-60 ms, 80-100 ms)");
    send(decoder, e, "RUN:0\nHIT:1\n", 200000);
    assert(!e.tick(200000));
    puts("HIT while stopped: PASS (silent)");
  }
  {
    FeedbackEngine e; LineDecoder decoder;
    send(decoder, e, "TONE:880\n", 0);
    for (int64_t t = 0; t < 80000; ++t) assert(e.tick(t) != 0);
    assert(e.tick(80000) == 0);
    puts("Menu tone: PASS (80 ms ON; active buzzer pitch is fixed by hardware)");
  }
  {
    FeedbackEngine e; LineDecoder decoder;
    send(decoder, e, "RUN:0\nBPM:120\nBEAT:0.5\nRUN:1\n", 0);
    for (int64_t t = 0; t < 15000000; t += 1000) e.tick(t);
    assert(e.running);
    assert(e.tick(15000000) == 0 && !e.running);
    send(decoder, e, "RUN:1\n", 15000001);
    assert(!e.running);
    puts("Missing SYNC: PASS (stops at 15 s; stale restart rejected)");
  }
  puts("\nPASS: all buzzer software bench checks.");
}
