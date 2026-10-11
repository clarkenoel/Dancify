import { defineConfig } from '@playwright/test';

const webPort = Number(process.env.DANCIFY_TEST_WEB_PORT || 5173);
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535) throw new Error('Invalid test web port');
const baseURL = `http://127.0.0.1:${webPort}`;
export default defineConfig({
  testDir: './tests/browser', timeout: 45000, workers: 1,
  use: {
    baseURL, headless: true,
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.env.CI ? undefined : '/usr/bin/chromium'), args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=/tmp/dancify-camera-fixture.y4m', '--enable-unsafe-swiftshader'] },
    permissions: ['camera'],
  },
  webServer: { command: `npm run dev -- --port ${webPort} --strictPort`, url: baseURL, reuseExistingServer: !process.env.CI, env: { VITE_DANCIFY_API_URL: process.env.DANCIFY_TEST_API || 'http://127.0.0.1:8001' } },
});
