/**
 * Graphics quality tiers.
 *
 * Two situations call for rendering less than the full-fat scene:
 *
 * 1. **`?lowfx=1`** — machines without hardware acceleration, most importantly
 *    the CI runners that execute the Playwright e2e suite on software WebGL
 *    (SwiftShader). There the fragment-bound cost of full-resolution
 *    rendering, shadow maps, bloom + afterimage post-processing, and the
 *    fishtank's transmission water pass dominates frame time (single frames
 *    taking several seconds each). None of that is relevant to what the e2e
 *    tests assert, so this flag switches the heavy GPU effects off.
 *
 * 2. **Phone/tablet-class devices** — reported as unusably choppy on an
 *    iPhone 13 (issue #304). A phone GPU has to run the same dozen patched
 *    shaders as a desktop one, at a device pixel ratio of 3, on a much
 *    smaller thermal budget.
 *
 * `?lowfx=0` explicitly forces the full-quality path back on, which is the
 * only way to tell "this phone is slow because of the effects" apart from
 * "this phone is slow for some other reason" without a rebuild.
 */

/** Devices whose smaller viewport dimension is at or below this many CSS px, *and* which report a coarse pointer, are treated as phone/tablet class. Both signals are required: a coarse pointer alone also matches large touchscreen desktops, and a narrow viewport alone matches a half-width desktop browser window. */
const MOBILE_MAX_MIN_VIEWPORT_PX = 900;

function detectMobileDevice(): boolean {
  try {
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const smallViewport = Math.min(window.innerWidth, window.innerHeight) <= MOBILE_MAX_MIN_VIEWPORT_PX;
    return coarsePointer && smallViewport;
  } catch {
    // Non-browser environments (e.g. unit tests) have no window/matchMedia.
    return false;
  }
}

function readLowFxOverride(): boolean | null {
  try {
    const value = new URLSearchParams(window.location.search).get('lowfx');
    if (value === '1') return true;
    if (value === '0') return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * `?dpr=<n>` — override the pixel-ratio cap for on-device experiments.
 *
 * Device telemetry (791 frames, iPhone 13) put 41.5ms of a 53.7ms frame in
 * `unaccountedMs` while our own JS totalled ~12ms, i.e. the frame is waiting
 * on the GPU, not on us. Fragment cost scales with the square of this number,
 * so it is the sharpest single lever available — and whether it helps tells
 * us directly whether the scene is fill-bound. Clamped to a sane range so a
 * typo cannot allocate a wildly oversized framebuffer.
 */
function readPixelRatioOverride(): number | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('dpr');
    if (raw === null) return null;
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.min(Math.max(value, 0.25), 3);
  } catch {
    return null;
  }
}

// Resolved once at module load: the answer cannot change without a reload,
// and callers (material construction, renderer setup) bake it into GPU state.
//
// `mobile` is a pure statement about the hardware, so the lowfx override must
// not influence it. Deriving it from the override (as this originally did)
// meant `?lowfx=1` on a phone reported the device as non-mobile, which handed
// it the full 460-creature desktop flock — turning a diagnostic switch into a
// heavier workload and masking the effect it was meant to isolate.
const lowFxOverride = readLowFxOverride();
const pixelRatioOverride = readPixelRatioOverride();
const mobile = detectMobileDevice();
const reduced = lowFxOverride ?? mobile;

/** True when the heavy optional effects (shadows, bloom, afterimage, depth of field, colour grading, antialiasing, fishtank water effects) should be skipped. */
export function isReducedGraphics(): boolean {
  return reduced;
}

/** True when running on a phone/tablet-class device. Independent of the effects tier: `?lowfx=0` turns the effects back on for an A/B comparison but does not pretend the phone is a desktop. */
export function isMobileDevice(): boolean {
  return mobile;
}

/**
 * Upper bound for `WebGLRenderer.setPixelRatio`.
 *
 * Fragment cost scales with the square of this number. A phone reporting
 * `devicePixelRatio: 3` would otherwise render ~2.25x the fragments of the
 * desktop path (which is already capped at 2) on far weaker hardware, so
 * phones get an intermediate cap: still sharper than 1:1, but a little over
 * half the fragments of the desktop cap.
 *
 * Keyed on the device rather than the effects tier, so toggling `?lowfx`
 * changes exactly one variable and an on-device A/B stays interpretable.
 */
export function getMaxPixelRatio(): number {
  if (pixelRatioOverride !== null) return pixelRatioOverride;
  if (mobile) return 1.5;
  return reduced ? 1 : 2;
}

/**
 * Picks a geometry detail level for the current device.
 *
 * Creature geometry is overwhelmingly the largest cost in the nature scene:
 * a scene-graph walk on an iPhone 13 measured 2,562,376 triangles per frame,
 * of which the ground plane was ~10k and essentially all the rest was
 * creature bodies (4,320 tris each) and wings (3,096 each, before instancing
 * across 30-60 birds per species). Fishtank, at 375,092, ran roughly twice as
 * fast with the same flock size.
 *
 * That cost is vertex-bound, which is why neither `?dpr` nor `?lowfx` moved
 * it: it is independent of both resolution and shading. Phones therefore get
 * coarser source geometry. Callers pass both values explicitly rather than a
 * scale factor, because the right mobile figure is a per-mesh judgement — a
 * wing panel needs enough interior vertices for its undulation shader to bend
 * convincingly, while a lathe's radial count only has to survive a silhouette
 * a few pixels across.
 */
export function pickGeometryDetail({ desktop, mobile }: { desktop: number; mobile: number }): number {
  return isMobileDevice() ? mobile : desktop;
}
/** Human-readable summary of the resolved tier, for the diagnostics overlay — the only practical way to confirm what is actually active on a phone screen. */
export function describeGraphicsTier(): string {
  const device = mobile ? 'mobile' : 'desktop';
  const effects = reduced ? 'reduced' : 'full';
  const source = lowFxOverride === null ? 'auto' : `forced by ?lowfx=${lowFxOverride ? '1' : '0'}`;
  const dpr = pixelRatioOverride === null ? '' : ` [?dpr=${pixelRatioOverride}]`;
  return `${device} / effects ${effects} (${source})${dpr}`;
}

