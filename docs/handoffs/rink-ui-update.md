# Rink UI, result audio and library deletion

Figma inspected 2026-10-11: file 73KXHiJcCoHRsR5XK54kQ7, main 15:237, light main 53:977, library 15:358, prepare 15:259/15:303, play 16:1193, results 15:586 and loading stars 33:54.

Shared controls now use the exported aqua outer and blue inset vector geometry with semantic theme colors. Bungee Inline/Jersey 25 typography uses the current 64/44/28/32/24/56px display/title/section/body/caption/score measurements. Loading and rating stars use exported artist layers, with reduced-motion support. The reference dancer remains clear; the target stays alongside the webcam as requested. Camera readiness, recovery, optional controller, accessible menu navigation and video.currentTime scoring stay intact.

Library rows expose Delete song with the same primary control treatment. A focused confirmation explains removal of video, prepared dance and saved history; Cancel/Escape restore focus. The existing API handles deletion; the client accepts HTTP 204 and only removes a row after server success. Songs being prepared or awaiting score sync cannot be deleted from the UI.

LoadingMusic loops during preparation. Eligible results with at least one star play Milestone followed by Winning1 once per session. Eligible zero-star results play Losing4 once. Practice/insufficient tracking has no result sound. Audio is stopped by navigation, replay, hidden tabs and unmount. The supplied recordings are untrimmed; the milestone lasts 24.53 seconds before win music.

Validation before the Windows command-runner failure: 151 web unit tests and production build passed. A Chrome browser check verified cancellation, one DELETE request, empty-library rendering and desktop screenshots. Additional failure-path regression is included for CI. Physical Bluetooth/control testing is deferred until the updated app is installed.
