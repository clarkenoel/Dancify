# Pre-hardware reliability handoff

Date: 2026-10-11. Working branch: `feat/codex-web-followup`.
Delivery: feature branch only, authorized for push after local verification.
No merge to main; the BLE protocol proposal still requires separate approval.

## Status

1. **Complete:** preparation/API/browser acceptance agrees with the actual
   full-body scorer. User chose Option 1: omit unusable checkpoints, report
   selected/retained/omitted counts, and fail preparation if none remain.
2. **Complete:** independent camera inference/startup watchdog, stream cleanup,
   late-result rejection and explicit recovery. No scoring calibration change.
3. **Complete locally:** frontend/build/launcher and real-media browser CI
   workflow added and corresponding commands tested. Remote GitHub execution
   and required-status branch protection remain unverified/unconfigured.
4. **Partially complete:** corrected documented UUIDs/framing and rotary hardware
   terminology. [Wearable output RFC](wearable-output-rfc.md) awaits product
   approval and explicit unfreezing of the BLE protocol.
5. **Not implemented:** browser-to-ESP32 feedback. Depends on task 4's agreed
   stop/resume and phase semantics. The frozen schema directory is unchanged.

Existing earlier branch work (readiness, replay countdown, rotary menus, BLE
input and the unconnected identity prototype) is preserved. This handoff does
not claim multi-person identity tracking or physical hardware acceptance.

## Changed files for tasks 1–4

| Files | Purpose |
|---|---|
| `backend/app/scoring_contract.py`, `pipeline/dancify_pipeline/scoring_contract.py` | Dependency-free target comparability checks matching the browser scorer |
| `pipeline/fixtures/scorable-targets.json` | Shared accepted/rejected geometry cases |
| `backend/app/chart_validation.py`, `pipeline/dancify_pipeline/schema_io.py`, `web/src/core/validation.ts` | Reject unusable charts; browser uses the actual scorer |
| `pipeline/dancify_pipeline/hits.py` | Omit invalid targets after exact serialization rounding |
| `pipeline/dancify_pipeline/pipeline.py`, `backend/app/report_validation.py`, `web/src/core/types.ts` | Produce/validate optional checkpoint quality counts |
| `web/src/components/GamePanel.tsx` | Explain omitted checkpoints to the player |
| `backend/tests/test_scoring_contract.py`, `pipeline/tests/test_scoring_contract.py`, `web/tests/scoring-contract.test.ts` | Shared contract regressions; rejected replacement preserves bundle/history |
| `pipeline/tests/test_pipeline_report.py`, `web/tests/validation.test.ts` | None/some/all omitted and report consistency cases |
| `web/src/core/camera.ts`, `web/tests/camera-timeout.test.ts` | Watchdog, cleanup, startup and late-callback regressions |
| `web/tests/browser/game.spec.ts` | Real-model stall/recovery, invalid old chart and explicit navigation fixtures |
| `web/src/App.tsx` | Distinct URL/upload input lifecycles remove controlled-input warning |
| `.github/workflows/web.yml`, `.github/workflows/backend.yml` | Automated regressions and shared-fixture trigger coverage |
| `web/scripts/test-integration.sh`, `web/playwright.config.ts` | Fresh database, owned services, two real prepared songs, CI Chromium selection |
| `backend/README.md`, `pipeline/README.md`, `web/README.md` | New validation behavior and reproducible verification commands |
| `PRD.md.md`, `AGENTS.md.md`, `firmware/AGENTS.md` | Existing UUID/framing corrections, current rotary terminology, pending contract status |
| `docs/handoffs/wearable-output-rfc.md` | Concrete proposed hardware behavior/contract for approval |

## Verification

Latest completed checks all passed:

- Frontend: **82 tests**, TypeScript check and Vite production build.
- Backend: **78 tests**.
- Pipeline: **65 tests**.
- Launcher: **8 tests**.
- Browser: **8 scenarios**, using an isolated API/database and real prepared
  media; the recorded dancer passes through the actual local pose model.
- Workflow YAML parsing, shell syntax and `git diff --check`.

The clean browser run first exposed a navigation test assumption that the
library already contained two songs. The runner now prepares two distinct
entries through the real pipeline; the test explicitly checks its prerequisite.
The full rerun passed. Earlier camera screenshot capture interfered with live
inference test timing; routine screenshots were removed while behavioral
assertions stayed, with failure screenshots enabled. A temporary deliberately
failing frontend test verified nonzero failure propagation and was removed.

Reproduce the isolated browser run (dependencies installed):

```bash
DANCIFY_TEST_WEB_PORT=5180 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  bash web/scripts/test-integration.sh
```

Ports 8765 and 5180 must be free. CI installs its own Playwright Chromium and
does not need the executable override. The runner cleans up only its own
services/data on success and retains diagnostics on failure.

The watchdog cannot interrupt synchronous WASM on a blocked browser main
thread; it rejects overdue results when execution returns. Stream tracks stop
on timeout, but detector disposal waits for an in-flight inference to settle.
Actual Windows webcam, BLE radio, firmware timing and subjective scoring
calibration still require teammate trials.
