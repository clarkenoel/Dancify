# Demo sound assets

Supplied by the user on 2026-10-11 and approved for the demo:

| File | Source | Event |
| --- | --- | --- |
| `scroll.mp3` | Scroll 3.mp3 | Rotary/keyboard menu focus movement |
| `button-click.mp3` | ButtonClick.mp3 | Button activation |
| `miss1.mp3` | Miss1.mp3 | Newly finalized MISS during active camera gameplay |

Audio streams were copied without trimming or re-encoding; embedded artwork and
metadata were removed. Chromium and FFmpeg decoded the files successfully, and
decoded PCM hashes matched the originals. The application applies a moderate
playback gain, with a lower gain for Miss1; the recordings themselves are unchanged.

LOST tracking is not a scored miss and has no miss sound. Hidden tabs, old
judgments, seeks and completed rounds do not produce catch-up miss sounds.

Winning1, LoadingMusic, Losing4 and Milestone are not bundled: their supplied MP4
files exceed the attachment downloader's size limit. Audio-only exports are still
needed. No replacement music or result sounds were invented. The final star cue
currently uses the wearable's existing short TONE command.
