# Web Integration Handoff

**Date:** 2026-10-10  
**Branch:** `cursor/web-integration-hardening-2805`  
**Frozen schema:** unchanged (`schema/dance.schema.json.json`, `schema/type.ts`)

Read [`gameplay-integration-contract.md`](gameplay-integration-contract.md) for the runtime contract and [`hit-timing-rfc.md`](hit-timing-rfc.md) before adding exact hit timestamps.

## Tracking diagnosis

Reproduced on `9fc295c` with OpenCV `4.11.0`, MediaPipe `0.10.18`, and FFmpeg `6.1.1`.

| Asset | SHA-256 |
|---|---|
| `pipeline/testdata/Video_1.mp4` | `cea7a2856dc7d2142420edc844a0751f5e339916bc3f912243f9088c6ab38d8e` |
| `pipeline/testdata/audio_1.m4a` | `cb70018c1fc945a9d95d190619b292198fec2cd33f09fe1e955cb32ad44db04b` |

The full muxed reference currently passes by a narrow margin: **1756/1833 valid frames (95.8%)**, longest invalid run **exactly 2.00s**. The onboarding failure at **2.16s** was the same class of dropout, not a different URL. Raw, interpolated, and smoothed masks agree, so smoothing and the visibility threshold are not the cause.

The failing interval is **60.28–62.24s**. Every invalid frame has `no_detection`, an invalid torso, and zero visible gameplay joints. Visual inspection shows a multi-coach collage followed by a Just Dance end card with no continuously framed solo dancer. That footage is genuinely unsupported by the solo detector. Thresholds were not lowered and long gaps are not interpolated.

The canonical seed now prepares the reviewed choreography range **0.0–59.5s**. That run has **29 moves**, **1478/1488 valid frames (99.3%)**, and a longest dropout of **0.36s** at the opening frames. Invalid frames remain unscorable; they do not become invented checkpoints.

Diagnostics survive rejection:

- `dance.tracking.json` — exact runs, reasons, and stage masks
- `dance.tracking.mp4` — source footage, skeleton, confidence, and reason overlay
- `_work/debug_arrays.npz`

Generate them with `python pipeline/debug/tracking_video.py <video>`.

## Preparation API

```bash
curl -s -X POST http://127.0.0.1:8000/songs/json \
  -H 'Content-Type: application/json' \
  -d '{"title":"Demo","source_url":"https://example.com/dance.mp4"}'

curl -s -X POST http://127.0.0.1:8000/songs/<SONG_ID>/preparations \
  -H 'Content-Type: application/json' \
  -d '{"source_kind":"url","start_time":0,"end_time":59.5}'

curl -s http://127.0.0.1:8000/songs/<SONG_ID>/preparations/<JOB_ID>
```

Upload fallback uses the same worker and validation:

```bash
curl -s -X POST http://127.0.0.1:8000/songs \
  -F 'title=Uploaded' \
  -F 'video=@/path/to/video-with-music.mp4'
curl -s -X POST http://127.0.0.1:8000/songs/<SONG_ID>/preparations \
  -H 'Content-Type: application/json' \
  -d '{"source_kind":"upload"}'
```

Poll until `succeeded` or `failed`. Active jobs deduplicate. Retry only a failed job. Song `status=ready` remains true while a replacement runs; the previous immutable bundle stays readable until publication. Failure codes are `download_failed`, `unsupported_media`, `timing_required`, `tracking_failed`, `validation_failed`, `internal`, and `interrupted`.

Configure URL access only through `DANCIFY_YTDLP_COOKIES_FILE` and optional `DANCIFY_YTDLP_IMPERSONATE`. Credentials must stay out of URLs, source, and logs.

## Bundle loading

Capture `active_bundle_id` before play and keep it for the whole session:

```text
GET /songs/{id}/bundles/{bundle_id}/video
GET /songs/{id}/bundles/{bundle_id}/chart
GET /songs/{id}/bundles/{bundle_id}/audio
GET /songs/{id}/bundles/{bundle_id}/report
```

The reference MP4 is H.264/AAC and is the only playback clock. The audio sidecar is a derivative. `POST /songs/{id}/plays` stores `bundle_id`, so regeneration does not reinterpret old scores. Reports expose timing source, synthetic timing, tracking runs, and normalization aspect ratio.

## Chart and pose contract

Each move is one static checkpoint over `start <= t < end`, with `is_hold=false`. Score the best valid comparison inside that window. Tracking loss is `null`, not a miss or zero. Do not infer an exact musical hit from the midpoint. The proposed `hit_time` and `source_pose_time` fields are in the RFC only.

Pose fixtures are in [`pipeline/fixtures/pose-normalization.json`](../../pipeline/fixtures/pose-normalization.json). Normalize MediaPipe image landmarks with the inference frame aspect ratio before hip/torso scaling. A near-zero torso is non-comparable.

## Verification

| Check | Result |
|---|---|
| Backend pytest | **42 passed** locally; GitHub Backend is green after the workflow installs FFmpeg |
| Pipeline pytest | **39 passed** locally; the workflow installs FFmpeg from the repository root so the step does not depend on the sparse checkout |
| Full canonical diagnostic | Passed at the 2.00s gate; dropout identified at 60.28–62.24s |
| Trimmed canonical seed | **BAKE OK**, 29 moves, ready bundle verified |
| Local upload preparation | **PREPARATION SMOKE OK**, 14 moves, immutable bundle and play recorded |
| URL preparation | **PREPARATION SMOKE OK** for the Kep1er TikTok with `DANCIFY_YTDLP_IMPERSONATE=chrome`, 5 moves |
| Browser decode | Backend serves `video/mp4`, `audio/wav`/`audio/x-wav`, and JSON; FFprobe requires H.264/AAC and aligned durations |
| Frozen schema | Unchanged |

YouTube downloads can still fail bot checks in other environments. That result must surface as `download_failed` and offer upload; it does not waive tracking or timing validation.
