# Just Dance hit calibration

## What Just Dance taught us

- Pictograms fire on **held / accent poses**, which show up as **motion-energy valleys** (settle after a move), not on mid-gesture energy peaks.
- Timing is quantized to the **beat (or half-beat)** — the coach “strikes” the pose on the count.
- Density is roughly **every 1–2 beats** for readable charts, not every local wiggle.

Official coach MP4s were **not downloadable** in this cloud env (YouTube bot-check). Calibration follows the above product rules + PRD §4.1 (dips = hit moments) and was validated on our TikTok solos (`sample_a` / `sample_b`) plus Kep1er smoke clip.

## MVP boundaries

This implementation is intentionally narrower than the full PRD:

- **Solo, stable, CFR clips only.** MediaPipe Pose is single-subject here; the
  pipeline rejects unstable tracking but cannot isolate identities in a crowd.
- Energy is confidence-masked normalized landmark speed, **not angular
  velocity** yet.
- Similar-pose hold merging is deferred; generated moves use `is_hold=false`.
- Librosa tempo can still choose a half/double-tempo octave. Exact grid snap
  does not prove the chosen BPM octave is musically correct.

## Code change (`dancify_pipeline/hits.py`)

**Before:** Beat-first — score each beat for nearby valley contrast, place hit **on the beat** even if the true valley was offset (dots could sit on energy slopes).

**After (JD-cal):** Valley-first —

1. Find local minima on smoothed motion energy.
2. Keep valleys within `0.35 × beat_period` of a beat/half-beat.
3. **Hit time** = snapped grid time (red marker on the count).
4. **Keyframe** = valley frame (actual held pose).
5. Score by valley depth − peak penalty at the grid sample; thin to ~every 2 beats.
6. Move windows **centered** on hit time (not lead-biased), so debug red = musical hit.
7. Exclude invalid tracking frames/keyframes; flat or unusable motion fails
   instead of falling back to a full chart.

If no prominent valley exists but motion is usable, fallback searches for a
local valid minimum every two **whole** beats. It never steps every two
half-beat grid slots.

## How to re-check

```bash
cd pipeline && source .venv/bin/activate
python debug/velocity.py testdata/sample_a.mp4 --out debug_out/sample_a_velocity.png
# Red dots = snapped hits; orange x = source valley; gray shading = tracking loss.
```

Mute clips require `--fallback-bpm` and `--fallback-downbeat`. Their
`*.report.json` marks timing synthetic and not cache-ready by default.
