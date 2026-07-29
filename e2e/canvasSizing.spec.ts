import { test, expect, type Page } from '@playwright/test';

/**
 * Regression cover for issue #304 — "boids look broken on an iPhone 13".
 *
 * The reported symptoms (creatures trapped in a vertical plane, everything
 * stretched horizontally) all came from one defect: the controls panel
 * animates its width over 0.15s, and `setPanelCollapsed` measured the canvas
 * *synchronously* right after toggling the class. On a 390px viewport the
 * panel still occupied 300 of those pixels at measurement time, so the app
 * sized both the WebGL drawing buffer and the simulation's world bounds from
 * a 90px-wide box that immediately became 330px.
 *
 * Nothing about that is iOS-specific — it reproduces in any engine at any
 * viewport narrow enough to trigger the auto-collapse — so these run on the
 * default chromium project rather than requiring a WebKit install.
 *
 * The two assertions below are deliberately about *shape*, not exact numbers:
 * a drawing buffer whose aspect ratio disagrees with the element it is
 * stretched across is the stretching, and a world narrower than the canvas is
 * the vertical plane.
 */

const IPHONE_13_VIEWPORT = { width: 390, height: 664 };

/** Small population: CI has no GPU and rasterizes every instance in software. See app.spec.ts for the full rationale. */
const SMALL_POPULATION = {
  boidCount: 8,
  parrotCount: 0,
  goldfinchCount: 0,
  cardinalCount: 0,
  bluejayCount: 0,
  predatorCount: 1,
  unicornCount: 1,
};

async function gotoNarrowApp(page: Page): Promise<void> {
  const state = { params: SMALL_POPULATION };
  await page.goto(`/?lowfx=1&state=${encodeURIComponent(JSON.stringify(state))}`);
  await expect(page.locator('#sim-canvas-3d')).toBeVisible();
  await settleCanvasMetrics(page);
}

/**
 * Waits until the canvas geometry stops changing.
 *
 * The panel has a 0.15s width transition and the drawing buffer is resized
 * from a ResizeObserver, so metrics read too early are mid-animation. The
 * suite used to allow for that with a flat 1s sleep, which is both slower than
 * needed once the layout has settled and no guarantee at all on a loaded CI
 * runner, where a 0.15s transition can take considerably longer to be
 * delivered. Two consecutive identical reads is the property actually wanted.
 *
 * The panel's own width is part of the sampled state, not just the canvas.
 * Two of the callers assert that a metric is *unchanged* across a toggle, so a
 * probe that could return before the transition began would let those tests
 * pass without ever observing the thing they exist to catch.
 */
async function settleCanvasMetrics(page: Page): Promise<CanvasMetrics> {
  let previous = '';
  let stable: CanvasMetrics | undefined;
  await expect
    .poll(
      async () => {
        const metrics = await readCanvasMetrics(page);
        const panelWidth = await page.evaluate(
          () => document.querySelector('#control-panel')!.getBoundingClientRect().width,
        );
        const serialised = JSON.stringify({ metrics, panelWidth });
        const unchanged = serialised === previous;
        previous = serialised;
        if (unchanged) stable = metrics;
        return unchanged;
      },
      { timeout: 30_000, intervals: [100, 100, 150, 250] },
    )
    .toBe(true);
  return stable!;
}

interface CanvasMetrics {
  bufferWidth: number;
  bufferHeight: number;
  cssWidth: number;
  cssHeight: number;
}

function readCanvasMetrics(page: Page): Promise<CanvasMetrics> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas-3d')!;
    return {
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
    };
  });
}

test.describe('narrow viewport layout', () => {
  test.use({ viewport: IPHONE_13_VIEWPORT });
  test('drawing buffer keeps the aspect ratio of the canvas it is displayed in', async ({ page }) => {
    await gotoNarrowApp(page);
    const { bufferWidth, bufferHeight, cssWidth, cssHeight } = await readCanvasMetrics(page);

    expect(cssWidth).toBeGreaterThan(0);
    expect(bufferWidth).toBeGreaterThan(0);

    // Before the fix this was ~0.16 against a displayed ~0.58 — a 3.6x
    // horizontal stretch. Allow 2% for the integer rounding in
    // resizeCanvases and three.js's own pixel-ratio rounding.
    const bufferAspect = bufferWidth / bufferHeight;
    const displayedAspect = cssWidth / cssHeight;
    expect(bufferAspect).toBeGreaterThan(displayedAspect * 0.98);
    expect(bufferAspect).toBeLessThan(displayedAspect * 1.02);
  });

  test('canvas fills the viewport width instead of the panel-squeezed box', async ({ page }) => {
    await gotoNarrowApp(page);
    const { cssWidth } = await readCanvasMetrics(page);

    // The simulation's world bounds are set from the same measurement as the
    // drawing buffer, three lines apart in resizeCanvases, so pinning the
    // canvas box is what pins the world. Before the fix the canvas settled at
    // 330px while the world stayed 90 units wide — the flock was confined to a
    // vertical slab a quarter of the screen's width.
    expect(cssWidth).toBeGreaterThan(IPHONE_13_VIEWPORT.width * 0.75);
  });

  test('expanding the controls panel does not shrink the canvas', async ({ page }) => {
    await gotoNarrowApp(page);
    const collapsed = await readCanvasMetrics(page);

    await page.click('#control-panel-toggle');
    const expanded = await settleCanvasMetrics(page);

    // On a narrow viewport the panel overlays the scene (see style.css's
    // max-width: 700px block) rather than taking 300px out of a 390px row,
    // which would otherwise reintroduce the 90px-wide world above.
    expect(expanded.cssWidth).toBe(collapsed.cssWidth);
    expect(expanded.bufferWidth).toBe(collapsed.bufferWidth);
  });
});

/**
 * The same stale-measurement defect also affected ordinary desktop use, which
 * is presumably why it went unreported for so long: it only shows up after a
 * manual panel toggle, and the next window resize silently corrects it.
 *
 * At a 1000px viewport, collapsing the panel widens the canvas from 700 to
 * 956 CSS px. Without a ResizeObserver the drawing buffer stays at 700 and is
 * stretched across the wider element — a 1.37x horizontal distortion, the
 * mild desktop version of what issue #304 reported on a phone.
 */
test.describe('panel toggle at desktop width', () => {
  test.use({ viewport: { width: 1000, height: 800 } });

  test('drawing buffer follows the canvas when the panel is collapsed', async ({ page }) => {
    const state = { params: SMALL_POPULATION };
    await page.goto(`/?lowfx=1&state=${encodeURIComponent(JSON.stringify(state))}`);
    await expect(page.locator('#sim-canvas-3d')).toBeVisible();

    const before = await settleCanvasMetrics(page);
    // This viewport is wide enough that the panel starts expanded and shares
    // the flex row, so collapsing it really does hand width to the canvas.
    expect(before.cssWidth).toBeLessThan(1000 * 0.85);

    await page.click('#control-panel-toggle');

    const after = await settleCanvasMetrics(page);
    expect(after.cssWidth).toBeGreaterThan(before.cssWidth);
    expect(after.bufferWidth / after.bufferHeight).toBeGreaterThan((after.cssWidth / after.cssHeight) * 0.98);
    expect(after.bufferWidth / after.bufferHeight).toBeLessThan((after.cssWidth / after.cssHeight) * 1.02);
  });
});
