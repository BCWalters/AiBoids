import { test, expect } from '@playwright/test';

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

test.describe('diagnostics overlay', () => {
  test('?debug=1 shows the rendering stats with the graphics tier', async ({ page }) => {
    await page.goto('/?debug=1');
    const overlay = page.locator('.rendering-stats-overlay');
    await expect(overlay).toBeVisible();

    // The tier line is the whole point of the flag: it answers "which quality
    // path is this device actually on?" without trusting what we intended.
    await expect(overlay).toContainText(/fx: (mobile|desktop) \/ effects (reduced|full)/);
    // Buffer dimensions are read back off the canvas, so they confirm the
    // pixel-ratio cap reached the renderer rather than merely being computed.
    await expect(overlay).toContainText(/buffer: \d+x\d+ @ [\d.]+x/);
  });

  test('?debug=0 keeps the overlay off', async ({ page }) => {
    await page.goto('/?debug=0');
    await page.waitForTimeout(500);
    await expect(page.locator('.rendering-stats-overlay')).toBeHidden();
  });

  test('leaves the overlay off when no debug param is given', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);
    await expect(page.locator('.rendering-stats-overlay')).toBeHidden();
  });

  test('keeps the overlay clear of the collapsed panel on a phone viewport', async ({ page }) => {
    await page.setViewportSize(IPHONE_13_VIEWPORT);
    await page.goto('/?debug=1');
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
