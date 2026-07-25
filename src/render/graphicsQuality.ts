/**
 * Optional low-effects graphics mode, opted into via `?lowfx=1` in the URL.
 *
 * On machines without hardware acceleration — most importantly the CI runners
 * that execute the Playwright e2e suite on software WebGL (SwiftShader) — the
 * fragment-bound cost of full-resolution rendering, shadow maps, bloom +
 * afterimage post-processing, and the fishtank's transmission water pass
 * dominates frame time (single frames taking several seconds each). None of
 * that is relevant to what the e2e tests assert (the app boots, every visual
 * style keeps rendering, instance colors are correct), so this flag lets the
 * tests switch the heavy GPU effects off and keep runs fast. It has no effect
 * on normal use, where the query parameter is absent.
 */
let reduced = false;
try {
  reduced = new URLSearchParams(window.location.search).get('lowfx') === '1';
} catch {
  // Non-browser environments (e.g. unit tests) have no window.location.
  reduced = false;
}

export function isReducedGraphics(): boolean {
  return reduced;
}
