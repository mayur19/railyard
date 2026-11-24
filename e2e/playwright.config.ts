import { defineConfig } from '@playwright/test';

/**
 * Smoke tests against a running dev stack (`./run.sh dev` in another terminal, or `./run.sh e2e`).
 * Not run in CI: CI has no browser install step. Set E2E=1 to enable.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  outputDir: './test-results',
  reporter: [['list'], ['html', { outputFolder: './report', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5105',
    trace: 'retain-on-failure',
  },
});
