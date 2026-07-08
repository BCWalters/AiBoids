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
  // CI runners have limited CPU and no GPU — several tests each running
  // their own software-rendered (SwiftShader) WebGL context in parallel
  // starve each other badly enough to blow through generous timeouts
  // (observed: a plain selectOption() call taking >60s under contention).
  // Running one test at a time on CI trades total wall-clock time for
  // reliability; locally (real GPU, no contention) full parallelism is
  // fine and fast.
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4319',
    trace: 'retain-on-failure',
    // CI runners have no GPU, so Chromium falls back to software WebGL
    // (SwiftShader). It works, but is much slower than a real GPU —
    // giving actions more time to complete avoids flaky timeouts there.
    actionTimeout: 20_000,
  },
  timeout: process.env.CI ? 90_000 : 30_000,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Explicitly force the software GL (SwiftShader) rasterizer
          // rather than relying on Chromium's default GPU-detection
          // fallback, which can be inconsistent across CI environments
          // and occasionally yields a canvas with no WebGL context at all.
          args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 4319 --strictPort --host',
    url: 'http://localhost:4319',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
