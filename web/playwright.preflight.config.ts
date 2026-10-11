import { defineConfig } from '@playwright/test';
import integration from './playwright.config';

// Share browser selection and launch options, but start no app server.
export default defineConfig({
  testDir: './scripts', testMatch: 'browser-preflight.spec.ts',
  timeout: 15000, workers: 1, retries: 0, reporter: 'line',
  outputDir: './test-results/preflight',
  use: integration.use,
});
