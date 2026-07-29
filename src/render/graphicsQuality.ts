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

// Resolved once at module load: the answer cannot change without a reload,
// and callers (material construction, renderer setup) bake it into GPU state.
const lowFxOverride = readLowFxOverride();
const mobile = lowFxOverride === null && detectMobileDevice();
const reduced = lowFxOverride ?? mobile;

/** True when the heavy optional effects (shadows, bloom, afterimage, depth of field, colour grading, antialiasing, fishtank water effects) should be skipped. */
export function isReducedGraphics(): boolean {
  return reduced;
}

/** True when running on a phone/tablet-class device. Distinct from `isReducedGraphics()`, which is also true for the forced `?lowfx=1` desktop/CI path — this one gates choices that only make sense for a real handheld device, such as smaller default creature populations. */
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
 */
export function getMaxPixelRatio(): number {
  if (reduced && !mobile) return 1;
  return mobile ? 1.5 : 2;
}

