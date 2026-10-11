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

The supplied LoadingMusic, Losing4, Milestone and Winning1 MP4 audio tracks were extracted locally using FFmpeg/libmp3lame quality 3, without trimming. loading.mp3 loops only during preparation. lose.mp3 plays once for an eligible zero-star result. result-win.mp3 concatenates Milestone then Winning1, in that order, for an eligible result with at least one star. Milestone is 24.53 seconds and the complete celebration is 81.38 seconds. Navigation, replay, hiding the tab and disposal stop playback. Reconnection never replays a completed result. These sounds never advance the video/scoring clock.
