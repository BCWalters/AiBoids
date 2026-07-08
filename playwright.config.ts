import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke tests that validate the app boots and its core interactive
 * features (mode/style switching, boids actually rendering) work.
 * Run standalone with `npm run test:e2e`; not part of the Vitest unit
 * suite (see vitest.config.ts, which excludes e2e/).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4319',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 4319 --strictPort --host',
    url: 'http://localhost:4319',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
