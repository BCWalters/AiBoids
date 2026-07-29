import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * `graphicsQuality` resolves its tier once at module load, because callers
 * bake the answer into GPU state (renderer construction, material choice)
 * and it cannot change without a reload. Each case therefore has to stub the
 * environment *before* importing the module, via resetModules + dynamic
 * import.
 */

interface Env {
  search?: string;
  coarsePointer?: boolean;
  innerWidth?: number;
  innerHeight?: number;
}

async function loadWithEnv(env: Env) {
  vi.resetModules();
  vi.stubGlobal('window', {
    location: { search: env.search ?? '' },
    innerWidth: env.innerWidth ?? 1440,
    innerHeight: env.innerHeight ?? 900,
    matchMedia: (query: string) => ({ matches: query.includes('coarse') ? (env.coarsePointer ?? false) : false }),
  });
  return import('./graphicsQuality');
}

const DESKTOP: Env = { coarsePointer: false, innerWidth: 1440, innerHeight: 900 };
const IPHONE_13: Env = { coarsePointer: true, innerWidth: 390, innerHeight: 664 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('graphicsQuality', () => {
  it('leaves a desktop browser on the full-quality tier', async () => {
    const q = await loadWithEnv(DESKTOP);
    expect(q.isReducedGraphics()).toBe(false);
    expect(q.isMobileDevice()).toBe(false);
    expect(q.getMaxPixelRatio()).toBe(2);
  });

  it('puts a phone on the reduced tier with an intermediate pixel-ratio cap', async () => {
    const q = await loadWithEnv(IPHONE_13);
    expect(q.isReducedGraphics()).toBe(true);
    expect(q.isMobileDevice()).toBe(true);
    // Between the desktop cap of 2 and the software-rendering cap of 1:
    // fragment cost scales with the square of this, so 1.5 is ~56% of the
    // desktop path's fragments rather than the 225% a raw DPR of 3 would give.
    expect(q.getMaxPixelRatio()).toBe(1.5);
  });

  it('requires both a coarse pointer and a small viewport', async () => {
    // A half-width desktop window: narrow, but a precise pointer.
    const narrowDesktop = await loadWithEnv({ coarsePointer: false, innerWidth: 600, innerHeight: 900 });
    expect(narrowDesktop.isMobileDevice()).toBe(false);

    // A large touchscreen display: coarse pointer, but plenty of viewport.
    const bigTouch = await loadWithEnv({ coarsePointer: true, innerWidth: 1920, innerHeight: 1080 });
    expect(bigTouch.isMobileDevice()).toBe(false);
  });

  it('treats a large phone in landscape as mobile', async () => {
    // Detection uses the *smaller* dimension so orientation cannot flip the
    // tier mid-session. The dimensions here are a 6.7" phone rotated: its
    // long edge (956) exceeds the threshold while its short edge (440) does
    // not, so a max-based check would wrongly promote it to the desktop tier.
    const q = await loadWithEnv({ coarsePointer: true, innerWidth: 956, innerHeight: 440 });
    expect(q.isMobileDevice()).toBe(true);

    const portrait = await loadWithEnv({ coarsePointer: true, innerWidth: 440, innerHeight: 956 });
    expect(portrait.isMobileDevice()).toBe(true);
  });

  it('honours ?lowfx=1 on a desktop, keeping the software-rendering cap', async () => {
    const q = await loadWithEnv({ ...DESKTOP, search: '?lowfx=1' });
    expect(q.isReducedGraphics()).toBe(true);
    // The e2e suite depends on this path staying at 1:1 — it exists to make
    // SwiftShader rasterization affordable on CI.
    expect(q.getMaxPixelRatio()).toBe(1);
    expect(q.isMobileDevice()).toBe(false);
  });

  it('keeps a phone recognised as mobile whatever ?lowfx says', async () => {
    // Regression: deriving `mobile` from the override made ?lowfx=1 on a
    // phone report the device as desktop, which handed it the full
    // 460-creature flock (main.ts gates the reduced counts on
    // isMobileDevice). The diagnostic switch became a heavier workload and
    // masked the very effect it was meant to isolate.
    for (const search of ['?lowfx=1', '?lowfx=0', '']) {
      const q = await loadWithEnv({ ...IPHONE_13, search });
      expect.soft(q.isMobileDevice(), `?lowfx should not change device class (${search || 'no param'})`).toBe(true);
      // Pixel ratio is a property of the device, so an on-device A/B changes
      // exactly one variable: the effects.
      expect.soft(q.getMaxPixelRatio(), `pixel ratio should track the device (${search || 'no param'})`).toBe(1.5);
    }
  });

  it('lets ?lowfx=0 turn the effects back on for an on-device comparison', async () => {
    const q = await loadWithEnv({ ...IPHONE_13, search: '?lowfx=0' });
    expect(q.isReducedGraphics()).toBe(false);
    // ...without pretending the phone is a desktop.
    expect(q.isMobileDevice()).toBe(true);
  });

  it('lets ?dpr override the pixel-ratio cap for on-device fill-rate tests', async () => {
    expect((await loadWithEnv({ ...IPHONE_13, search: '?dpr=1' })).getMaxPixelRatio()).toBe(1);
    // Must beat the desktop cap upward too, or it can only ever confirm the
    // direction we already suspect.
    expect((await loadWithEnv({ ...DESKTOP, search: '?dpr=3' })).getMaxPixelRatio()).toBe(3);
    // Surfaced in the overlay, so an A/B on the phone is self-describing.
    expect((await loadWithEnv({ ...IPHONE_13, search: '?dpr=1' })).describeGraphicsTier()).toContain('?dpr=1');
  });

  it('clamps or ignores nonsense ?dpr values rather than trusting them', async () => {
    // 0 or negative would produce a zero-area framebuffer; huge values would
    // allocate an enormous one. Both are a typo away on a phone keyboard.
    expect((await loadWithEnv({ ...IPHONE_13, search: '?dpr=0' })).getMaxPixelRatio()).toBe(1.5);
    expect((await loadWithEnv({ ...IPHONE_13, search: '?dpr=-2' })).getMaxPixelRatio()).toBe(1.5);
    expect((await loadWithEnv({ ...IPHONE_13, search: '?dpr=abc' })).getMaxPixelRatio()).toBe(1.5);
    expect((await loadWithEnv({ ...IPHONE_13, search: '?dpr=99' })).getMaxPixelRatio()).toBe(3);
  });

  it('describes the resolved tier well enough to read off a phone screen', async () => {
    const auto = await loadWithEnv(IPHONE_13);
    expect(auto.describeGraphicsTier()).toContain('mobile');
    expect(auto.describeGraphicsTier()).toContain('reduced');
    expect(auto.describeGraphicsTier()).toContain('auto');

    const forced = await loadWithEnv({ ...IPHONE_13, search: '?lowfx=0' });
    // Must name the override, so "did my URL param take effect?" is
    // answerable from the overlay alone.
    expect(forced.describeGraphicsTier()).toContain('full');
    expect(forced.describeGraphicsTier()).toContain('lowfx=0');

    const desktop = await loadWithEnv(DESKTOP);
    expect(desktop.describeGraphicsTier()).toContain('desktop');
    expect(desktop.describeGraphicsTier()).toContain('full');
  });

  it('falls back to full quality when there is no window at all', async () => {
    vi.resetModules();
    vi.stubGlobal('window', undefined);
    const q = await import('./graphicsQuality');
    expect(q.isReducedGraphics()).toBe(false);
    expect(q.isMobileDevice()).toBe(false);
  });
});
