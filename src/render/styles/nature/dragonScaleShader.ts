import * as THREE from 'three';

export interface DragonScaleConfig {
  /**
   * Number of scale cells across the body's dorsoventral (Z) span.
   * `uDragonScaleFreq = scalesPerLength / zSpan` where `zSpan` is the full
   * dorsoventral extent of the body geometry bounding box. Using the Z span
   * gives isotropic cell sizes in world space, matching the approach used by
   * fishScaleShader and seaHorsePlateShader.
   */
  scalesPerLength: number;
  /**
   * Darkness multiplier at each scale's trailing arc (free edge).
   * 0 = no effect (skips patching entirely); 1 = fully black edge.
   */
  edgeDarkness: number;
  /**
   * Darkness multiplier applied at each scale's central keel — the narrow
   * lengthwise ridge running head-to-tail through each scale. This carina is
   * characteristic of reptilian scales and absent from fish scales. 0 = no
   * keel; 1 = fully black keel line.
   */
  scaleKeelDarkness: number;
  /**
   * Roughness reduction at each scale's centre, simulating a slightly raised,
   * reflective surface. 0 = no highlight; 1 = fully specular. Keep subtle
   * (0.15–0.25 works well).
   */
  scaleGloss: number;
}

/**
 * Reptilian scale config for the nature dragon.
 *
 * Dragon scales are overlapping (shingled, like fish scales) and keeled —
 * each scale carries a lengthwise carina (ridge) running parallel to the
 * spine. The keel is the defining visual difference from fish scales.
 *
 * Cell size at production dragon geometry (Z span ≈ 15.95 wu):
 *   scalesPerLength = 20 → cell ≈ 0.80 wu
 *
 * This is deliberately coarser than any fishtank fish:
 *   goldfish ≈ 0.094 wu, barracuda ≈ 0.113 wu, butterflyfish ≈ 0.448 wu
 * and sits within the seahorse bony-plate range (0.44–0.82 wu), reading as
 * large, structural reptilian plates rather than fine fish-scale texture.
 */
/**
 * Which model-space plane the scale cells are laid out in.
 *
 * The pattern is 2D, so BOTH of its axes must actually vary across the surface
 * being textured. Y (the spine axis) always varies, so only the second axis is
 * selectable:
 *
 *  - 'yz' — for tube-like parts (body, tail), whose Z is the dorsoventral axis.
 *  - 'yx' — for the membrane wings, which are near-flat panels in the XY plane.
 *
 * Getting this wrong does not merely rotate the pattern, it COLLAPSES it. The
 * dragon wing spans X 2.796 and Y 2.527 but only Z 0.138, with 42% of its
 * vertices at exactly Z = 0. Sampling it as 'yz' freezes the second coordinate,
 * so the cells degenerate into parallel bands running out along the span —
 * stripes, not scales.
 */
export type DragonScalePlane = 'yz' | 'yx';

export const DRAGON_SCALE_CONFIG: DragonScaleConfig = {
  scalesPerLength: 20,
  edgeDarkness: 0.30,
  scaleKeelDarkness: 0.20,
  scaleGloss: 0.20,
};

/**
 * Patches a MeshStandardMaterial with a procedural reptilian scale pattern
 * injected via onBeforeCompile.
 *
 * Visual model:
 *   Dragon scales are overlapping (shingled like roof tiles) and keeled:
 *   each scale has a central lengthwise ridge (carina/keel) running parallel
 *   to the spine, which is characteristic of reptilian scales and absent from
 *   fish scales. The overlap uses the same staggered-row (brick) layout as
 *   fishScaleShader — alternate Z-axis rows offset by half a cell — producing
 *   interlocking crescents. Scale circles are rounder (less elliptical) than
 *   fish scales.
 *
 * Pattern co-ordinates use rest-space position (vDragonScalePos = position
 * captured before any deformation in the vertex shader) so the scale pattern
 * stays fixed to the skin at all times.
 *
 * Composes safely with any previously-installed onBeforeCompile patch:
 * captures any existing onBeforeCompile and calls it first, and augments
 * customProgramCacheKey rather than replacing it.
 *
 * GLSL safety: the injected fragment code writes only to diffuseColor (a
 * local vec4) and roughnessFactor (a local float). It never writes to vColor:
 * vColor is a read-only `in` under GLSL 300 ES (assigning to it would cause a
 * "l-value required" link error that blacks out the entire scene), and roughness
 * is a uniform. Both diffuseColor and roughnessFactor are mutable locals,
 * assignable in all GLSL versions three.js targets.
 */
export function applyDragonScaleShader(
  material: THREE.MeshStandardMaterial,
  bodyGeometry: THREE.BufferGeometry,
  config: DragonScaleConfig,
  patternPlane: DragonScalePlane = 'yz',
): void {
  if (config.edgeDarkness === 0) return;

  if (!bodyGeometry.boundingBox) bodyGeometry.computeBoundingBox();
  const bb = bodyGeometry.boundingBox!;
  // Drive frequency from the dorsoventral (Z) span, matching the approach
  // used by the fish-scale and seahorse-plate shaders. The dragon body's Z
  // span captures the full dorsoventral extent after the neck bend, giving
  // isotropic cell sizes in world space regardless of body proportions.
  const zSpan = Math.max(1e-6, bb.max.z - bb.min.z);
  const freq = config.scalesPerLength / zSpan;
  // patternPlane MUST be part of the cache key. three.js reuses a compiled
  // program whenever the cache key matches, so omitting it would let the wing
  // silently render with the body's program and lose its own plane.
  const planeSwizzle = patternPlane === 'yz' ? 'vDragonScalePos.z' : 'vDragonScalePos.x';

  const cacheKey = `aiboids-dragon-scale-v3:${patternPlane}:${freq.toFixed(5)}:${config.edgeDarkness.toFixed(4)}:${config.scaleKeelDarkness.toFixed(4)}:${config.scaleGloss.toFixed(4)}`;

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
      `varying vec3 vDragonScalePos;\nvarying float vScaleSuppress;\nattribute float aScaleSuppress;\n` + shader.vertexShader;
    // Capture the REST-space (pre-deformation) model position right before
    // vColor is set. Using the rest position means the scale pattern stays
    // fixed to the skin regardless of any body animation applied later.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      `vDragonScalePos = position;\nvScaleSuppress = aScaleSuppress;\n#include <color_vertex>`,
    );

    // --- Fragment shader ---
    // Declare the varying (in) and uniforms at the top.
    shader.fragmentShader =
      `varying vec3 vDragonScalePos;\nvarying float vScaleSuppress;\nuniform float uDragonScaleFreq;\nuniform float uScaleEdgeDarkness;\nuniform float uScaleKeelDarkness;\nuniform float uScaleGloss;\n` +
      shader.fragmentShader;

    // Inject the scale pattern AFTER roughnessmap_fragment. That chunk sets
    // roughnessFactor (a local float), which we can then reduce for gloss.
    // roughnessmap_fragment comes after color_fragment, so diffuseColor
    // already carries the folded-in vColor at this point.
    //
    // Both diffuseColor and roughnessFactor are mutable locals — writing to
    // them is valid in all GLSL versions. We never write to vColor (read-only
    // `in` in GLSL 300 ES) or to roughness (a uniform).
    // The aScaleSuppress attribute is 1 on vertices that must NOT be scaled (the
    // eye and nostril discs — a keel groove across an iris makes the eye read as
    // scaly skin rather than wet) and 0 everywhere else.
    //
    // The sense is deliberately "suppress" rather than "draw". A missing vertex
    // attribute reads as 0 in GLSL, and this shader is applied to the wing and
    // tail materials using the BODY geometry (so all three share one pattern
    // frequency and the scale rows run continuously across the seams) — so the
    // wing and tail meshes never carry this attribute at all. With a "draw"
    // mask they read 0 and lose their scales entirely; with "suppress" they
    // read 0 and correctly keep them.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
  if ( vScaleSuppress < 0.5 ) {
    // Overlapping reptilian scale pattern on the YZ body plane.
    // Y = spine axis (tail→head); Z = dorsal-ventral axis.
    // Alternate spine rows are staggered by half a cell (brick/hex layout)
    // so scale arcs interlock. Pattern uses rest-space vDragonScalePos so
    // it stays fixed to the skin.
    vec2 sp = vec2( vDragonScalePos.y, ${planeSwizzle} ) * uDragonScaleFreq;
    sp.y += floor( sp.x ) * 0.5;
    vec2 fp = fract( sp ) - 0.5;  // cell-local coords in [-0.5, 0.5]

    // Dragon scales are rounder than fish scales (not elongated ellipses).
    // kScaleR > 0.5 so adjacent rows overlap, exposing only the trailing
    // crescent of each scale (the shingled free edge).
    const float kScaleR = 0.60;
    float r = length( fp );
    // Row-above circle for shingling (one head-ward cell).
    float rAbove = length( vec2( fp.x + 1.0, fp.y ) );

    // Visible crescent mask: 1 = exposed free (tail-facing) edge, 0 = hidden.
    float visible = smoothstep( kScaleR - 0.04, kScaleR + 0.04, rAbove );

    // Free-edge arc: darkened band at the trailing boundary of each scale.
    float edge = smoothstep( kScaleR - 0.14, kScaleR, r )
               * ( 1.0 - smoothstep( kScaleR, kScaleR + 0.06, r ) );

    // Keel: a narrow darkened ridge running along each scale's spine axis.
    // The keel bisects each scale at fp.y ≈ 0 (dorsoventral centre) and is
    // only visible on the exposed crescent, not under the row above.
    // This carina is the characteristic feature of reptilian scales.
    const float kKeelHW = 0.07;
    float scaleMask = max( 0.0, 1.0 - r / kScaleR ) * visible;
    float keel = smoothstep( kKeelHW, 0.0, abs( fp.y ) ) * scaleMask;

    // --- Colour: darken free edge and keel ---
    diffuseColor.rgb *= 1.0 - uScaleEdgeDarkness * edge * visible;
    diffuseColor.rgb *= 1.0 - uScaleKeelDarkness * keel;

    // --- Roughness: scale centres are slightly glossier ---
    float gloss = uScaleGloss * max( 0.0, 1.0 - r / kScaleR ) * visible;
    roughnessFactor = clamp( roughnessFactor - gloss, 0.0, 1.0 );
  }`,
    );

    Object.assign(shader.uniforms, {
      uDragonScaleFreq: { value: freq },
      uScaleEdgeDarkness: { value: config.edgeDarkness },
      uScaleKeelDarkness: { value: config.scaleKeelDarkness },
      uScaleGloss: { value: config.scaleGloss },
    });
  };

  material.needsUpdate = true;
}
