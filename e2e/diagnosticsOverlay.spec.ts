import { test, expect } from '@playwright/test';
import { waitForFrames } from './waitForFrames';

/**
 * Cover for the diagnostics overlay as a *field instrument*.
 *
 * The overlay is how a graphics question gets answered on a device we cannot
 * attach a profiler to, so the properties that matter are unusually mundane:
 * it has to actually appear, and it has to be readable. Both failed in ways a
 * unit test could not see.
 *
 * `?debug=1` was first wired to `params.showDebugOverlay` — a real flag, but
 * the one that drives the 2D renderer's debug drawing, not this panel (which
 * reads `params.showRenderingStats`). The parser had full unit cover and was
 * perfectly correct; the flag it was assigned to was wrong. Only loading the
 * page catches that, hence these tests.
 *
 * The second failure was purely visual: on a narrow viewport the collapsed
 * control panel is an absolutely-positioned overlay pinned to the right, and
 * it painted on top of the stats. Every long line lost its tail — including
 * the entity total and the `post` phase timing — while the element's own
 * scrollWidth stayed clean, so the text measured fine and read as garbage.
 */

const IPHONE_13_VIEWPORT = { width: 390, height: 664 };

/**
 * These tests are about wiring and legibility, not about how much scenery the
 * renderer can chew through, so they load the smallest flock that still
 * exercises the real render path. Without this they inherit the full desktop
 * flock and were the slowest specs in the core shard under SwiftShader, where
 * building full-detail creature geometry starves the main thread.
 *
 * `lowfx=1` is included for the same reason. It does not weaken anything below:
 * the tier assertion accepts either tier by design, since the point is that the
 * overlay reports whatever is actually active rather than what we assumed.
 */
function overlayUrl(query: string): string {
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
  const separator = query.includes('?') ? '&' : '?';
  return `${query}${separator}state=${encodeURIComponent(JSON.stringify(state))}&lowfx=1`;
}

test.describe('diagnostics overlay', () => {
  test('?debug=1 shows the rendering stats with the graphics tier', async ({ page }) => {
    await page.goto(overlayUrl('/?debug=1'));
    const overlay = page.locator('.rendering-stats-overlay');
    await expect(overlay).toBeVisible();

    // The tier line is the whole point of the flag: it answers "which quality
    // path is this device actually on?" without trusting what we intended.
    await expect(overlay).toContainText(/fx: (mobile|desktop) \/ effects (reduced|full)/);
    // Buffer dimensions are read back off the canvas, so they confirm the
    // pixel-ratio cap reached the renderer rather than merely being computed.
    // Generous timeout: the overlay reports these only once the renderer has
    // warmed up, and warm-up is frame-paced, so on a loaded CI worker sharing
    // a GPU with other specs it can take far longer than the 5s default.
    await expect(overlay).toContainText(/buffer: \d+x\d+ @ [\d.]+x/, { timeout: 30_000 });
  });

  // `?debug=0` and "no param at all" are the same assertion about the same
  // default, and each was paying a full page load — which under software WebGL
  // is several seconds of shader compilation for a check that reads one class.
  // Kept as distinct navigations because the two inputs really are different
  // (an explicit off switch versus an absent one), but folded into a single
  // test so the fixture is paid once.
  test('keeps the overlay off unless debug is explicitly on', async ({ page }) => {
    for (const query of ['/?debug=0', '/']) {
      await page.goto(overlayUrl(query));
      // One rendered frame proves the app booted far enough to have shown the
      // overlay if it were going to; without that this asserts "not yet" and
      // would pass on a page that had not started.
      await waitForFrames(page, 1);
      await expect(page.locator('.rendering-stats-overlay')).toBeHidden();
    }
  });

  test('keeps the overlay clear of the collapsed panel on a phone viewport', async ({ page }) => {
    await page.setViewportSize(IPHONE_13_VIEWPORT);
    await page.goto(overlayUrl('/?debug=1'));
    const overlay = page.locator('.rendering-stats-overlay');
    await expect(overlay).toBeVisible();

    // Measured with a single page.evaluate rather than locator.boundingBox():
    // the overlay repaints every frame, and Playwright's actionability waits
    // on a perpetually-changing element burn the whole test timeout without
    // telling us anything about the geometry we actually care about.
    const geometry = await page.evaluate(() => {
      const overlayEl = document.querySelector<HTMLElement>('.rendering-stats-overlay')!;
      const panelEl = document.querySelector<HTMLElement>('#control-panel')!;
      return {
        overlayRight: overlayEl.getBoundingClientRect().right,
        panelLeft: panelEl.getBoundingClientRect().left,
        clipped: overlayEl.scrollWidth > overlayEl.clientWidth + 1,
      };
    });

    // The panel sits on top, so any horizontal overlap is text the user
    // cannot read, however correct the numbers behind it are.
    expect(geometry.overlayRight).toBeLessThanOrEqual(geometry.panelLeft);

    // And nothing may be clipped inside the box either — on a narrow screen
    // the long phase lines have to wrap rather than run off the edge.
    expect(geometry.clipped).toBe(false);
  });
});
