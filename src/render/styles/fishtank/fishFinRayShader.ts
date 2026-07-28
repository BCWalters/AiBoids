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
  brightness: 0.12,
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
  brightness: 0.10,
  halfRayWidth: 0.12,
};

/**
 * Patches a MeshStandardMaterial with a procedural fin-ray lightening pattern
 * injected via onBeforeCompile.
 *
 * Visual model:
 *   Real bony-fish fins are stiffened by spines that all originate at the body
 *   seam and FAN OUT toward the edge, so they converge at the root and spread
 *   at the tip (see the reference drawing on issue #242).
 *
 *   This is therefore an ANGULAR pattern, not a linear one. Banding on a single
 *   model axis (e.g. `fract(position.y * freq)`) produces evenly spaced
 *   PARALLEL lines whose spacing at the root equals their spacing at the tip —
 *   which reads as corrugation, not as rays. The rays must be bands of constant
 *   ANGLE about the root.
 *
 * Fin frame:
 *   Each fin is a near-flat panel, but the two fin types lie in different planes
 *   and are rooted at opposite ends of different axes (measured on shipped
 *   geometry):
 *
 *     pectoral (wingLeft):  X 0.00 → 4.01 (root at X=0), Y = chord, Z flat (0.04)
 *     caudal   (tail):      Y -16.0 → -26.6 (root at max Y), Z = chord, X flat (0.12)
 *
 *   So the caller supplies which axis runs root→tip (`spanAxis`) and which runs
 *   across the fin (`chordAxis`). The root END of the span axis, the root point
 *   and the fin's true angular extent are all measured from the geometry rather
 *   than assumed — which is what lets one frame drive both fins of a mirrored
 *   pair.
 *
 * Frequency derivation:
 *   Rays are spread evenly across the fin's MEASURED angular extent, so each fin
 *   shows exactly `raysPerSpan` rays regardless of its size or aspect ratio.
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
/** Which model axis a fin runs along. */
export type FinAxis = 'x' | 'y' | 'z';

const AXIS_INDEX: Record<FinAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/**
 * Describes how a particular fin sits in model space, so the fan can be built
 * about its real root instead of assuming an axis. See the doc block above for
 * the measured values of the shipped fins.
 */
export interface FinRayFrame {
  /** Axis running from the body seam out to the fin edge. */
  spanAxis: FinAxis;
  /** Axis running across the fin (the chord). */
  chordAxis: FinAxis;
}

/**
 * Pectoral fins extrude laterally along X from the body wall at X = 0.
 *
 * Deliberately carries no direction: the left fin spans x 0 → +1.37 and the
 * right fin spans x −1.37 → 0, and both are driven from this one frame. See
 * measureFinFrame for how the root is detected instead.
 */
export const PECTORAL_FIN_FRAME: FinRayFrame = { spanAxis: 'x', chordAxis: 'y' };

/** The caudal fin extends aft along Y; its chord is vertical (Z). */
export const CAUDAL_FIN_FRAME: FinRayFrame = { spanAxis: 'y', chordAxis: 'z' };

/**
 * Measures the fan origin and angular extent of a fin from its actual vertices.
 *
 * The root is taken at the seam end of the span axis, centred on the chord
 * *there* rather than on the whole-geometry chord centre: fins are tapered, so
 * the chord midpoint at the root is generally not the bounding-box midpoint,
 * and a fan struck from the wrong origin sprays asymmetrically.
 */
function measureFinFrame(
  geometry: THREE.BufferGeometry,
  frame: FinRayFrame,
): { rootSpan: number; rootChord: number; halfAngle: number; spanExtent: number } {
  const pos = geometry.getAttribute('position');
  const si = AXIS_INDEX[frame.spanAxis];
  const ci = AXIS_INDEX[frame.chordAxis];
  const read = (i: number, axis: 0 | 1 | 2) =>
    axis === 0 ? pos.getX(i) : axis === 1 ? pos.getY(i) : pos.getZ(i);

  // Seam end of the span axis, DETECTED rather than declared: a fin attaches to
  // the body, so its root is whichever end of the span axis lies nearer the
  // model origin, and its tip is the far end.
  //
  // This used to be a hard-coded spanSign on the frame, which silently broke
  // mirrored fins. The left and right pectorals share one frame but span
  // opposite directions (x 0 → +1.37 against x −1.37 → 0), so a fixed +1 made
  // the right fin's span negative at every vertex — the root fade then
  // evaluated to zero across the whole fin and its rays vanished entirely.
  let spanMin = Infinity;
  let spanMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const v = read(i, si);
    spanMin = Math.min(spanMin, v);
    spanMax = Math.max(spanMax, v);
  }
  const rootSpan = Math.abs(spanMin) <= Math.abs(spanMax) ? spanMin : spanMax;

  // Chord centre in a thin slab at the seam, and the widest angle any vertex
  // subtends about that origin. Both are measured, not assumed.
  let spanExtent = 0;
  for (let i = 0; i < pos.count; i++) {
    spanExtent = Math.max(spanExtent, Math.abs(read(i, si) - rootSpan));
  }
  const slab = Math.max(1e-6, spanExtent * 0.05);
  let chordMin = Infinity;
  let chordMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(read(i, si) - rootSpan) > slab) continue;
    const c = read(i, ci);
    chordMin = Math.min(chordMin, c);
    chordMax = Math.max(chordMax, c);
  }
  const rootChord = Number.isFinite(chordMin) ? (chordMin + chordMax) * 0.5 : 0;

  let halfAngle = 0;
  for (let i = 0; i < pos.count; i++) {
    // abs(), not a signed multiply: every vertex of a correct fin lies on one
    // side of its root plane, so the two are equal in magnitude — but abs() is
    // mirror-safe and needs no direction to be declared up front.
    const s = Math.abs(read(i, si) - rootSpan);
    if (s <= 1e-4) continue;
    halfAngle = Math.max(halfAngle, Math.abs(Math.atan2(read(i, ci) - rootChord, s)));
  }
  // Guard against a degenerate fin collapsing the fan to a single line.
  return { rootSpan, rootChord, halfAngle: Math.max(halfAngle, 1e-3), spanExtent };
}

export function applyFishFinRayShader(
  material: THREE.MeshStandardMaterial,
  finGeometry: THREE.BufferGeometry,
  config: FishFinRayConfig,
  frame: FinRayFrame = PECTORAL_FIN_FRAME,
): void {
  if (config.raysPerSpan === 0) return;

  const { rootSpan, rootChord, halfAngle, spanExtent } = measureFinFrame(finGeometry, frame);
  // Spread `raysPerSpan` rays evenly across the fin's measured angular extent,
  // so the count is independent of fin size and aspect ratio.
  const freq = config.raysPerSpan / (2 * halfAngle);

  const cacheKey = `aiboids-fin-ray-v3:${frame.spanAxis}${frame.chordAxis}:${freq.toFixed(5)}:${rootSpan.toFixed(4)}:${rootChord.toFixed(4)}:${config.brightness.toFixed(4)}:${config.halfRayWidth.toFixed(4)}`;

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
      `varying vec3 vFinRayPos;\nuniform float uFinRayFreq;\nuniform float uFinRayBrightness;\nuniform float uFinRayHalfWidth;\nuniform float uFinRayRootSpan;\nuniform float uFinRayRootChord;\nuniform float uFinRaySpanExtent;\n` +
      shader.fragmentShader;

    // Inject the ray pattern immediately after color_fragment, which has
    // already folded vColor into diffuseColor. Writing to diffuseColor here
    // is safe: it is a mutable local vec4 in all GLSL versions three.js
    // targets. We never write to vColor (read-only `in` in GLSL 300 ES).
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  {
    // Fin-ray pattern: rays of constant ANGLE about the fin root, so they
    // converge at the body seam and fan out toward the edge (issue #242).
    // vFinRayPos is the rest-space (pre-undulation) vertex position, so the
    // pattern stays welded to the fin skin regardless of animation.
    //
    // The span/chord components below are substituted per fin type: the
    // pectoral fin runs out along +X with a Y chord, the caudal fin runs aft
    // along -Y with a Z chord. Banding on a raw axis instead would give
    // parallel lines, which read as corrugation rather than as rays.
    // abs() makes this mirror-safe: the left and right fins of a pair span
    // opposite directions from the same root, so a signed span would go negative
    // across one of them and the root fade below would erase its rays.
    float finSpan  = abs( FIN_SPAN_COMP - uFinRayRootSpan );
    float finChord = FIN_CHORD_COMP - uFinRayRootChord;
    // Angle subtended at the root. Clamping span to a small positive value
    // keeps the few vertices exactly ON the seam (span == 0) from producing a
    // ±PI/2 discontinuity that would draw a hard line down the attachment.
    float finAngle = atan( finChord, max( finSpan, 1e-4 ) );
    float t = fract( finAngle * uFinRayFreq );
    // halfDist = 0 at each integer phase (= ray centre), 0.5 at mid-gap.
    float halfDist = min( t, 1.0 - t );
    // Smooth bright spike at each ray, zero in the membrane between rays.
    float ray = smoothstep( uFinRayHalfWidth, 0.0, halfDist );
    // Fade the rays out at the very root: all rays meet there, so at full
    // strength the convergence point burns out into a bright blob.
    ray *= smoothstep( 0.0, 0.12, finSpan / max( uFinRaySpanExtent, 1e-4 ) );
    // Lighten diffuseColor at each ray. Adding brightness lifts toward white;
    // clamped to [0,1] so we never blow out. Colours are in LINEAR space.
    diffuseColor.rgb = min( vec3( 1.0 ), diffuseColor.rgb + uFinRayBrightness * ray );
  }`,
    );

    // Substitute the per-fin axis components. These are compile-time swizzles
    // rather than uniforms because they select which component is read; the
    // chosen axes are part of customProgramCacheKey so three.js does not reuse
    // another fin's compiled program (a cache collision here silently no-ops
    // the whole change).
    // replaceAll, not replace: these tokens must not survive anywhere in the
    // source. A single leftover is a GLSL compile error that blacks out every
    // patched fin, and shader-string tests do not catch it.
    shader.fragmentShader = shader.fragmentShader
      .replaceAll('FIN_SPAN_COMP', `vFinRayPos.${frame.spanAxis}`)
      .replaceAll('FIN_CHORD_COMP', `vFinRayPos.${frame.chordAxis}`);

    Object.assign(shader.uniforms, {
      uFinRayFreq: { value: freq },
      uFinRayBrightness: { value: config.brightness },
      uFinRayHalfWidth: { value: config.halfRayWidth },
      uFinRayRootSpan: { value: rootSpan },
      uFinRayRootChord: { value: rootChord },
      uFinRaySpanExtent: { value: spanExtent },
    });
  };

  material.needsUpdate = true;
}
