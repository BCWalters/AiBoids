import { test, expect, type Page } from '@playwright/test';

/**
 * Key end-to-end smoke tests, run at PR time (see .github/workflows/ci.yml
 * and package.json's test:e2e script) to catch regressions that unit
 * tests can't: does the app actually boot in a real browser, does
 * switching modes/visual styles keep it rendering, and are boids/creatures
 * actually visible on screen (not just "no JS exceptions thrown").
 */

/**
 * Navigates to the app with a drastically smaller population than the
 * real default (150 boids + 75 of each of 4 more species + 5 hawks + 2
 * unicorns = 457 rendered creatures) via the existing `?state=` deep-link
 * mechanism (see main.ts's readStateFromURL/DeepLinkState — it merges
 * this partial object over the full defaults via Object.assign, so we
 * only need to specify the counts we want to shrink). CI runners have no
 * GPU, so every one of those ~457 instances gets rasterized in software
 * (SwiftShader) on every frame; that's the dominant cost of these tests
 * (observed: ~2 minutes for 5 tests on CI vs. ~25s locally with a real
 * GPU), not Playwright/browser startup overhead. A handful of creatures
 * is still plenty to exercise "is anything actually rendering" /
 * "are boids visible" assertions while cutting per-frame instance count
 * by ~40x. Keeps at least one of each rendered kind (boid + predator +
 * unicorn) so tests still meaningfully cover every render path.
 */
async function gotoApp(page: Page, path = '/'): Promise<void> {
  const state = {
    params: {
      boidCount: 8,
      parrotCount: 0,
      goldfinchCount: 0,
      cardinalCount: 0,
      bluejayCount: 0,
      predatorCount: 1,
      unicornCount: 1,
    },
  };
  const separator = path.includes('?') ? '&' : '?';
  await page.goto(`${path}${separator}state=${encodeURIComponent(JSON.stringify(state))}`);
}

/** Fails the test if the page logs a console error or an uncaught exception. */
function failOnConsoleErrors(page: Page): void {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      throw new Error(`Console error: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    throw new Error(`Uncaught page error: ${err.message}`);
  });
}

/**
 * Samples pixels across the given canvas locator and returns true if it
 * finds more than one distinct color — i.e. something is actually being
 * drawn (sky/ground/creatures), not just a single flat clear color or a
 * blank/transparent canvas.
 */
/**
 * Returns true if the given canvas locator's rendered pixels contain
 * more than a single flat color — i.e. something is actually being drawn
 * (sky/ground/creatures), not just a blank/cleared canvas.
 *
 * We deliberately screenshot the canvas (rather than reading pixels back
 * via canvas.getContext(...).getImageData in-page) because a WebGL
 * context's default `preserveDrawingBuffer: false` means the drawing
 * buffer can already be cleared by the time in-page JS reads it back,
 * even though the compositor just painted real content on screen a
 * moment earlier. Playwright's screenshot goes through the browser's own
 * compositing output, so it reliably captures what's actually on screen.
 */
async function canvasHasVisibleContent(page: Page, canvasSelector: string): Promise<boolean> {
  // Use a clipped full-page screenshot rather than locator.screenshot():
  // the locator variant runs Playwright's element actionability checks
  // (scroll-into-view + "wait until stable") first, which can time out
  // on CI runners doing slow software WebGL rendering even though the
  // canvas itself is perfectly stable — a full-page screenshot skips
  // those per-element checks entirely.
  const box = await page.locator(canvasSelector).boundingBox();
  if (!box) return false;
  const png = await page.screenshot({ clip: box });
  // A canvas that's just a single flat clear color compresses to a tiny
  // PNG (often well under 1KB) regardless of resolution; real rendered
  // content (sky gradients, terrain, creatures) compresses to something
  // much larger. This avoids needing a PNG-decoding dependency just to
  // check "is there visible variety here".
  return png.length > 5000;
}

test.describe('App smoke tests', () => {
  test('loads without console errors and shows the 3D nature canvas by default', async ({ page }) => {
    failOnConsoleErrors(page);
    await gotoApp(page);
    await expect(page).toHaveTitle(/AiBoids/);
    await expect(page.locator('#sim-canvas-3d')).toHaveClass(/active/);
    // Give the render loop a few frames to draw sky/ground/creatures.
    await page.waitForTimeout(1000);
    expect(await canvasHasVisibleContent(page, '#sim-canvas-3d')).toBe(true);
  });

  test('control panel toggle button shows and hides the panel', async ({ page }) => {
    await gotoApp(page);
    const panel = page.locator('#control-panel');
    const toggle = page.locator('#control-panel-toggle');
    const initiallyCollapsed = await panel.evaluate((el) => el.classList.contains('collapsed'));
    await toggle.click();
    await expect
      .poll(async () => panel.evaluate((el) => el.classList.contains('collapsed')))
      .toBe(!initiallyCollapsed);
  });

  test('cycling through every visual style keeps the 3D canvas rendering', async ({ page }) => {
    test.setTimeout(60_000);
    failOnConsoleErrors(page);
    await gotoApp(page);
    const styleSelect = page.locator('#param-visual-style');
    const styles = await styleSelect.locator('option').allTextContents();
    expect(styles.length).toBeGreaterThanOrEqual(2);

    const values = await styleSelect.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value),
    );

    for (const value of values) {
      await styleSelect.selectOption(value);
      await page.waitForTimeout(500);
      expect(await canvasHasVisibleContent(page, '#sim-canvas-3d')).toBe(true);
    }
  });

  test('switching to 2D mode shows the 2D canvas with visible boids, and back to 3D', async ({ page }) => {
    failOnConsoleErrors(page);
    await gotoApp(page);
    const modeSelect = page.locator('#param-mode');

    await modeSelect.selectOption('2d');
    await expect(page.locator('#sim-canvas-2d')).toHaveClass(/active/);
    await page.waitForTimeout(500);
    expect(await canvasHasVisibleContent(page, '#sim-canvas-2d')).toBe(true);

    await modeSelect.selectOption('3d');
    await expect(page.locator('#sim-canvas-3d')).toHaveClass(/active/);
    await page.waitForTimeout(500);
    expect(await canvasHasVisibleContent(page, '#sim-canvas-3d')).toBe(true);
  });

  test('language switcher updates visible UI text', async ({ page }) => {
    await gotoApp(page);
    const heading = page.locator('#control-panel-heading');
    await expect(heading).toHaveText('Controls');

    await page.locator('#param-language').selectOption('es');
    await expect.poll(() => heading.textContent()).not.toBe('Controls');
  });
});
