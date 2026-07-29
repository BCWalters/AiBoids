import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `node`, not `jsdom`. Only 2 of the 88 suites touch the DOM at all — the
    // rest are simulation maths, geometry builders and shader-source checks —
    // but a global jsdom environment charged every one of them for the setup:
    // ~50s of the suite's aggregate CPU time, against 2.5s now. The two that
    // need a DOM opt back in with a `@vitest-environment jsdom` docblock.
    //
    // This is safe to keep as the default because no source module guards on
    // `typeof window`/`typeof document`: anything that actually needs the DOM
    // throws under `node` rather than quietly taking a headless branch, so a
    // suite cannot become vacuous by being in the wrong environment.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Playwright e2e specs live under e2e/ and are run separately via
    // `npm run test:e2e` (Playwright Test), not by Vitest.
    exclude: ['node_modules/**', 'e2e/**'],
  },
});
