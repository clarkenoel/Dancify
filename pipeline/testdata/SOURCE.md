# Smoke-test clip provenance

## Intended primary
- URL: https://www.youtube.com/watch?v=HKRlrJNT6EQ
- Title: BTS / Jimin — Permission to Dance challenge Short (15s)
- Result: **Blocked** in this cloud environment (`Sign in to confirm you're not a bot`). TikTok URLs also failed (impersonation / unexpected response). Cobalt/Invidious/ytdl-core likewise blocked.

## Fallback used (meets use-case bar)
- **Video:** Mixkit stock #4823 — single woman dancing outdoors, full body, clear choreography (~10.3s).
  - Source: `https://assets.mixkit.co/videos/4823/4823-720.mp4`
  - Mixkit listing context: free-stock-video/dance/
- **Audio:** SoundHelix Song 1 (instrumental with clear beat), muxed for “dancing to a song” beat tracking.
  - Source: `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3`
- **Assembly:** cropped/scaled to **720×1280** (Shorts/TikTok aspect), ≤20s, H.264 + AAC → `sample.mp4`
- **Why valid for Dancify:** ≤20s, **one dancer** in frame, **dancing to music**, portrait short-form — same ingest shape as a TikTok/YouTube Short.

Do not commit `sample.mp4` (gitignored). Re-fetch with `python -m dancify_pipeline.fetch_sample` or the commands in README.
