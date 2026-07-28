import * as THREE from 'three';

/**
 * Configuration for the fin-ray lightening shader applied to fishtank fish fins.
 * `raysPerSpan = 0` disables the shader entirely (no-op, no onBeforeCompile set).
 */
export interface FishFinRayConfig {
  /**
   * Number of evenly-spaced ray bands across the fin's Y (spine-axis) span.
   * Frequency is derived as `raysPerSpan / ySpan` so the count is consistent
   * regardless of absolute fin size — a goldfish and a barracuda each get this
   * many visible rays per fin.
   */
  raysPerSpan: number;
  /**
   * Maximum brightening at each ray centre, in linear colour space. Added to
   * diffuseColor.rgb; clamped to [0, 1]. Keep subtle — these fins are thin
   * and viewed at tank distance. 0.25–0.35 reads as a soft light stripe.
   */
  brightness: number;
  /**
   * Half-width of each ray in fractional cell units [0, 0.5].
   * 0.12 means the bright spike occupies ±12% of the cell around each integer
   * phase, leaving ~76% of the cell as the darker membrane between rays.
   * Exported so the JS test port uses the same constant as the GLSL uniform.
   */
  halfRayWidth: number;
}

/**
 * Bony-plate fin-ray config for the small fish (Tetra, Goldfish, Clownfish,
 * Blue Tang) and Butterflyfish. Eight rays per fin is in the real-fish
 * range for these small aquarium species and reads clearly at tank viewing
 * distance.
 */
export const BONY_FISH_FIN_RAY_CONFIG: FishFinRayConfig = {
  raysPerSpan: 8,
  brightness: 0.30,
  halfRayWidth: 0.12,
};

/**
 * Fin-ray config for the barracuda (normal fishtank predator). Barracuda fins
 * are larger than small-fish fins (their pectoral chord is ~3× longer), but
 * `raysPerSpan` counts bands *across the actual fin span*, so this still gives
 * 8 visible rays per fin regardless of absolute world-unit size. Brightness is
 * slightly lower than the bony-fish config to suit the barracuda's already
 * pale/dark steel fin colours.
 */
export const BARRACUDA_FIN_RAY_CONFIG: FishFinRayConfig = {
  raysPerSpan: 8,
  brightness: 0.25,
  halfRayWidth: 0.12,
};

/**
 * Patches a MeshStandardMaterial with a procedural fin-ray lightening pattern
 * injected via onBeforeCompile.
 *
 * Visual model:
 *   Real bony-fish fins consist of evenly-spaced radial spines (fin rays)
 *   connected by a thin membrane. This shader approximates that appearance by
 *   creating periodic bright bands along the fin's Y (fish-spine) axis.  Each
 *   band is a smooth Gaussian-like spike centred on an integer phase value
 *   (`vFinRayPos.y × uFinRayFreq`), with the membrane between bands staying at
 *   the fin's natural colour.
 *
 *   At typical side-on tank-viewing angle, the Y-axis bands appear as parallel
 *   light lines running from root to tip — the characteristic radiating-spine
 *   look of a real fish fin.
 *
 * Frequency derivation:
 *   `uFinRayFreq = raysPerSpan / ySpan`, where `ySpan` is the full Y extent of
 *   the representative fin geometry (wingLeft). Using the fin's own Y span
 *   gives a consistent ray count regardless of absolute creature size — a small
 *   tetra and a large barracuda each show exactly `raysPerSpan` ray bands.
 *
 * Composition:
 *   Composes safely with fishUndulationShader by capturing the REST-SPACE
 *   (pre-undulation) model position via `vFinRayPos = position` injected before
 *   `#include <color_vertex>`. The undulation shader patches `#include
 *   <begin_vertex>` and `#include <beginnormal_vertex>` — no overlap. The fish
 *   scale shader (fishScaleShader.ts) is on the BODY material; fin rays are on
 *   the WING material — they share no material instance.
 *
 * GLSL safety:
 *   The injected fragment code writes only to `diffuseColor` (a local vec4).
 *   It never writes to `vColor` (read-only `in` under GLSL 300 ES) or any
 *   uniform. Injection site is immediately after `#include <color_fragment>`,
 *   which folds `vColor` into `diffuseColor` — so `diffuseColor.rgb` already
 *   carries the vertex colour at the point of injection. Vertex colours are
 *   stored LINEAR (not sRGB); the brightening is also applied in linear space.
 *
 * @param material     MeshStandardMaterial to patch (will have onBeforeCompile set).
 * @param finGeometry  Representative fin geometry (wingLeft) whose Y bounding-box
 *                     span is used to derive `uFinRayFreq`.
 * @param config       Per-species ray config.
 */
export function applyFishFinRayShader(
  material: THREE.MeshStandardMaterial,
  finGeometry: THREE.BufferGeometry,
  config: FishFinRayConfig,
): void {
  if (config.raysPerSpan === 0) return;

  if (!finGeometry.boundingBox) finGeometry.computeBoundingBox();
  const bb = finGeometry.boundingBox!;
  // Frequency derived from the fin's own Y span so the band count is consistent
  // across species. A small tetra pectoral fin (Y span ≈ 1.7 world units) and a
  // barracuda pectoral fin (Y span ≈ 3.5 world units) both show `raysPerSpan`
  // bands with the same visual density.
  const ySpan = Math.max(1e-6, bb.max.y - bb.min.y);
  const freq = config.raysPerSpan / ySpan;

  const cacheKey = `aiboids-fin-ray-v1:${freq.toFixed(5)}:${config.brightness.toFixed(4)}:${config.halfRayWidth.toFixed(4)}`;

  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);

  material.customProgramCacheKey = () => {
    const base = previousCacheKey?.() ?? '';
    return base.length ? `${base}|${cacheKey}` : cacheKey;
  };

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);

    // --- Vertex shader ---
    // Declare the varying at the top so it survives Three.js's GLSL version
    // transform (varying → out in WebGL 2 / GLSL 300 ES).
    shader.vertexShader =
      `varying vec3 vFinRayPos;\n` + shader.vertexShader;
    // Capture the REST-SPACE (pre-undulation) model position right before
    // vColor is set. Using the rest position means the ray pattern stays
    // fixed to the skin surface even when the fin mesh is animated.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      `vFinRayPos = position;\n#include <color_vertex>`,
    );

    // --- Fragment shader ---
    // Declare the varying (in) and uniforms at the top.
    shader.fragmentShader =
      `varying vec3 vFinRayPos;\nuniform float uFinRayFreq;\nuniform float uFinRayBrightness;\nuniform float uFinRayHalfWidth;\n` +
      shader.fragmentShader;

    // Inject the ray pattern immediately after color_fragment, which has
    // already folded vColor into diffuseColor. Writing to diffuseColor here
    // is safe: it is a mutable local vec4 in all GLSL versions three.js
    // targets. We never write to vColor (read-only `in` in GLSL 300 ES).
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  {
    // Fin-ray pattern: periodic bright lines along the fish-spine (Y) axis.
    // vFinRayPos is the rest-space (pre-undulation) vertex position, so the
    // pattern stays fixed to the fin skin regardless of animation.
    // Y = fish spine; bands repeat every 1/uFinRayFreq world units, giving
    // uFinRayFreq * ySpan = raysPerSpan evenly-spaced rays across the fin.
    float finPhase = vFinRayPos.y * uFinRayFreq;
    float t = fract( finPhase );
    // halfDist = 0 at each integer phase (= ray centre), 0.5 at mid-gap.
    float halfDist = min( t, 1.0 - t );
    // Smooth bright spike at each ray, zero in the membrane between rays.
    float ray = smoothstep( uFinRayHalfWidth, 0.0, halfDist );
    // Lighten diffuseColor at each ray. Adding brightness lifts toward white;
    // clamped to [0,1] so we never blow out. Colours are in LINEAR space.
    diffuseColor.rgb = min( vec3( 1.0 ), diffuseColor.rgb + uFinRayBrightness * ray );
  }`,
    );

    Object.assign(shader.uniforms, {
      uFinRayFreq: { value: freq },
      uFinRayBrightness: { value: config.brightness },
      uFinRayHalfWidth: { value: config.halfRayWidth },
    });
  };

  material.needsUpdate = true;
}
