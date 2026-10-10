# Smoke-test clip provenance

## Primary attempt (YouTube Short) — still blocked

- URL: https://www.youtube.com/watch?v=HKRlrJNT6EQ (Permission to Dance challenge Short)
- Retries: 2026-10-10 AM + ~10:25 UTC with latest `yt-dlp`, Deno, android/web clients.
- Result: **Bot check** (`Sign in to confirm you're not a bot` / 403). Needs `--cookies-from-browser` on a real laptop session.

## Real TikTok used for smoke (2026-10-10 ~10:29 UTC)

- URL: https://www.tiktok.com/@official_kep1er/video/7225090219391896834
- Title context: Kep1er — **Giddy Isolation Dance** (`#Giddychallenge`)
- Duration: **~10.1s**, **1080×1920**, AAC audio
- Framing: **one dancer visible per frame** (isolation-style cuts between members — not a multi-person simultaneous shot)
- Download that worked in cloud:

```bash
yt-dlp --impersonate chrome -f "b" -o pipeline/testdata/sample.mp4 \
  'https://www.tiktok.com/@official_kep1er/video/7225090219391896834'
```

## Offline fallback (if TikTok/YT both fail)

Mixkit #4823 dancer + SoundHelix music → Shorts-format assemble via `python -m dancify_pipeline.fetch_sample`.

Do **not** commit `sample.mp4` (gitignored).
