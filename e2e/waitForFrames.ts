import { expect, type Page } from '@playwright/test';

/**
 * Waits until the app's render loop has completed at least `frames` frames.
 *
 * This replaces the `waitForTimeout(...)` calls the suite used to sprinkle
 * around before pixel assertions. A fixed sleep is wrong in both directions:
 * on a developer GPU it idles long after the scene is up, and on CI — where
 * SwiftShader compiles the scene's shaders over several seconds — it can
 * expire before a single frame has been drawn, so the assertion that follows
 * either fails spuriously or passes for want of anything to look at.
 *
 * Waiting on the frame count returns as soon as the renderer is genuinely
 * ready, which is both quicker on fast machines and more patient on slow ones.
 *
 * The default of 3 frames is deliberate: the first frame after a scene or mode
 * switch can still be mid-upload, so one frame is not proof the scene is drawn.
 */
export async function waitForFrames(page: Page, frames = 3, timeout = 60_000): Promise<void> {
  const start = await currentFrame(page);
  await expect
    .poll(() => currentFrame(page), { timeout })
    .toBeGreaterThanOrEqual(start + frames);
}

async function currentFrame(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __aiboidsFrames?: number }).__aiboidsFrames ?? 0,
  );
}
