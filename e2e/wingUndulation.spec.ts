/**
 * Playwright smoke tests for wing undulation (#250) and unicorn tail
 * undulation (#251).
 *
 * These tests verify that the vertex-shader patches do not produce GLSL
 * compilation errors or link errors that would black out the nature scene.
 * They also confirm that the canvas renders visible content — a blank/black
 * canvas would indicate a shader crash.
 *
 * Tagged @nature so CI runs these in the nature job.
 *
 * timeout is set to 180 000 ms — SwiftShader (the software WebGL used by
 * headless Chromium on CI) compiles shaders ~10× slower than hardware, and
 * the default 30 s is not enough.
 */
import { test, expect, type Page } from '@playwright/test';
import { waitForFrames } from './waitForFrames';

const WEBGL_ERROR_RE =
  /l-value|ERROR: \d|failed to compile|failed to link|INVALID_OPERATION|THREE\.WebGLProgram/i;

/**
 * Collects all console messages of type 'error' or 'pageerror' and returns
 * those matching the WEBGL_ERROR_RE filter after the provided async action.
 */
async function collectWebGLErrors(
  page: Page,
  action: () => Promise<void>,
): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && WEBGL_ERROR_RE.test(msg.text())) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    if (WEBGL_ERROR_RE.test(err.message)) {
      errors.push(`pageerror: ${err.message}`);
    }
  });
  await action();
  return errors;
}

/**
 * Returns PNG byte-length of a screenshot of #sim-canvas-3d's bounding box.
 * A healthy rendered scene should be well above 5000 bytes; a blank/black
 * canvas compresses to < 1000 bytes.
 */
async function canvasPngLength(page: Page): Promise<number> {
  const box = await page.locator('#sim-canvas-3d').boundingBox();
  if (!box) return 0;
  const png = await page.screenshot({ clip: box, timeout: 60_000 });
  return png.length;
}

test.describe('Wing and tail undulation shaders — nature scene smoke', () => {
  test(
    'nature scene renders without WebGL errors after wing/tail undulation shaders load',
    {
      tag: ['@nature'],
    },
    async ({ page }) => {
      test.setTimeout(180_000);

      const state = {
        params: {
          boidCount: 4,
          parrotCount: 0,
          goldfinchCount: 0,
          cardinalCount: 0,
          bluejayCount: 0,
          predatorCount: 1,
          unicornCount: 1,
        },
      };
      const url = `/?state=${encodeURIComponent(JSON.stringify(state))}&lowfx=1`;

      const errors = await collectWebGLErrors(page, async () => {
        await page.goto(url);
        // Wait for real rendered frames rather than a fixed sleep. A shader
        // compile or link failure surfaces on the first frame that tries to
        // use the program, so frames drawn — not milliseconds elapsed — is
        // what makes this assertion meaningful. Under SwiftShader the old
        // 8s sleep was sometimes barely enough to reach the first frame, in
        // which case "no errors" only meant "nothing had run yet".
        await waitForFrames(page, 10, 120_000);
      });

      // Assert: zero WebGL / shader errors
      expect(errors, `WebGL errors detected:\n${errors.join('\n')}`).toHaveLength(0);

      // Assert: the canvas is rendering real content, not blank/black
      const pngLen = await canvasPngLength(page);
      expect(pngLen, `Canvas appears blank (${pngLen} bytes); expected > 5000`).toBeGreaterThan(5000);
    },
  );
});
