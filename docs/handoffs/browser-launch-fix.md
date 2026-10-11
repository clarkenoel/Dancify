# Browser launch configuration fix

Date: 2026-10-11. Branch: `feat/codex-web-followup`.

## Cause and change

GitHub run 38115015030 installed Chromium under the default user cache, then
`web/scripts/test-integration.sh` exported a temporary `XDG_CACHE_HOME`.
Playwright consequently searched a different directory. All eight browser tests
failed before launch. Local runs had used an explicit system Chromium executable,
which bypassed the broken lookup.

- `.github/workflows/web.yml`: set job-wide `PLAYWRIGHT_BROWSERS_PATH` to
  `${{ github.workspace }}/.playwright-browsers` for installation and execution.
- `web/playwright.preflight.config.ts` and `web/scripts/browser-preflight.spec.ts`:
  reuse the integration browser options to launch Chromium and render a page,
  without starting the app server.
- `web/scripts/test-integration.sh`: run that check after cache isolation and
  before API startup or media preparation. Preserve explicit browser overrides.
- `web/tsconfig.json`: type-check the new configuration and preflight test.
- `web/README.md`: document reproducing CI's downloaded-browser selection.

## Local verification

- Installed Playwright's matching Chromium/headless shell in
  `/tmp/dancify-playwright-browsers`.
- Ran the isolated integration script with that `PLAYWRIGHT_BROWSERS_PATH`,
  `DANCIFY_TEST_WEB_PORT=5180`, and no `PLAYWRIGHT_CHROMIUM_EXECUTABLE` override:
  **preflight passed; all eight browser scenarios passed**. These include real
  media preparation and the actual local pose model with recorded camera input.
- Pointed the same runner at an empty browser directory: nonzero exit and no
  backend log or prepared media, confirming failure before expensive setup.
- Explicit `/usr/bin/chromium` override passed preflight despite an empty
  Playwright browser directory.
- **87 frontend tests, 8 launcher tests and production build passed.**
- Workflow parsing, shell syntax and `git diff --check` passed. No test services
  remained listening after completion.

No application logic or runtime dependency changes. Feature-branch publication
is authorized; no merge to main. A successful local run does not establish a
green GitHub check; the updated workflow must run after this change is pushed.

The first publication used `runner.temp` in job-level `env`, which GitHub
rejects because the runner context is unavailable there. It was replaced with
`github.workspace`; actionlint verifies the corrected expression and workflow.
