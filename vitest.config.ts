import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // Playwright e2e specs live under e2e/ and are run separately via
    // `npm run test:e2e` (Playwright Test), not by Vitest.
    exclude: ['node_modules/**', 'e2e/**'],
  },
});
