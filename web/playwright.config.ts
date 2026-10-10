import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser', timeout: 45000, workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173', headless: true,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=/tmp/dancify-camera-fixture.y4m', '--enable-unsafe-swiftshader'] },
    permissions: ['camera'],
  },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, env: { VITE_DANCIFY_API_URL: process.env.DANCIFY_TEST_API || 'http://127.0.0.1:8001' } },
});
