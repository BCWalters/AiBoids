import { test, expect } from '@playwright/test';
import { waitForFrames } from './waitForFrames';

/**
 * E2E smoke tests for the bird feather shader.
 *
 * These tests verify:
 *   1. The nature scene renders without any WebGL/shader errors after the
 *      feather shader is applied to birds (body, wings, tail).
 *   2. The canvas produces visible, non-trivial content (not a blank canvas
 *      or a single flat clear colour).
 *
 * Uses a precise error-signature filter to catch real shader errors while
 * ignoring known benign THREE.js deprecation notices.
 *
 * Playwright test spec lives in e2e/ (testDir: './e2e' in playwright.config.ts).
 * Tagged @nature so CI can run it as part of the nature scene job.
 */

test.describe('Bird feather shader — nature scene smoke tests', () => {
  test(
    'nature scene renders without WebGL shader errors after bird feather shader @nature',
    async ({ page }) => {
      test.setTimeout(180_000);

      // Collect only real WebGL/shader/link errors; ignore THREE's
      // PCFSoftShadowMap deprecation notice and other benign console output.
      const shaderErrors: string[] = [];
      page.on('console', (msg) => {
        if (
          msg.type() === 'error' &&
          /l-value|ERROR: \d|failed to compile|failed to link|INVALID_OPERATION|THREE\.WebGLProgram/i.test(
            msg.text(),
          )
        ) {
          shaderErrors.push(msg.text());
        }
      });
      page.on('pageerror', (err) => {
        shaderErrors.push(`PAGEERROR: ${err.message}`);
      });

      // Force the nature scene with a tiny population so the test runs quickly
      // under software WebGL (SwiftShader).  One of each bird type exercises
      // every feather-shader code path without multiplying per-frame cost.
      const state = {
        params: {
          mode: '3d',
          visualStyle: 'nature',
          boidCount: 4,
          parrotCount: 1,
          goldfinchCount: 1,
          cardinalCount: 1,
          bluejayCount: 1,
          predatorCount: 1,
          unicornCount: 0,
          monsterCount: 0,
        },
      };
      await page.goto(
        `/?state=${encodeURIComponent(JSON.stringify(state))}&lowfx=1`,
      );

      // Wait for real frames rather than a fixed sleep: a GLSL link failure
      // only surfaces on the frame that first uses the program, so frames
      // drawn is what makes the error assertion below mean anything.
      await waitForFrames(page, 10, 120_000);

      // Confirm 0 WebGL / shader errors — a GLSL link error blacks out the
      // scene entirely but does NOT throw a JS exception, so only the console
      // filter above catches it.
      expect(shaderErrors).toHaveLength(0);

      // Confirm the canvas shows real rendered content.  A single-colour or
      // blank canvas compresses to < 1 KB; a healthy nature scene is ~348 KB.
      const box = await page.locator('#sim-canvas-3d').boundingBox();
      expect(box, 'canvas bounding box must exist').not.toBeNull();
      const png = await page.screenshot({ clip: box!, timeout: 60_000 });
      expect(
        png.length,
        'canvas PNG too small — scene may be blank or solid black',
      ).toBeGreaterThan(5000);
    },
  );
});
