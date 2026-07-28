import * as THREE from 'three';

export interface FishScaleConfig {
  /**
   * Number of scale cells across the body's dorsoventral (Z) span.
   * `uFishScaleFreq = scalesPerLength / zSpan` where `zSpan` is the full
   * dorsoventral extent of the body geometry bounding box. Using the Z span
   * as the reference gives isotropic cell sizes in world space: a goldfish
   * (zSpan ≈ 1.9) and a barracuda (zSpan ≈ 6.8) both get cells of the same
   * world-unit size at the same `scalesPerLength` value, so neither ends up
   * with a vanishingly thin slice of cells across its flank.
   */
  scalesPerLength: number;
  /**
   * Darkness multiplier applied at each scale's trailing arc (free edge).
   * 0 = no effect (skips patching entirely); 1 = fully black edge.
   */
  edgeDarkness: number;
  /**
   * Roughness reduction at each scale's centre. 0 = no highlight; 1 = fully
   * specular. Keep subtle — 0.15–0.30 reads as "somewhat reflective" without
   * turning fish into chrome.
   */
  scaleGloss: number;
}

/**
 * Internal shader constant: scale-circle radius in normalised cell coordinates.
 * Exported so the JS test port can use the same value as the GLSL constant.
 * Values > 0.5 mean adjacent circles overlap, creating the shingled crescent.
 */
export const FISH_SCALE_RADIUS = 0.62 as const;

/**
 * Bony plate scales for small fish (Tetra, Goldfish, Clownfish, Blue Tang)
 * and Butterflyfish. Twenty visible scale cells across the dorsoventral (Z)
 * body span, with a quarter-darkened arc rim and subtle per-scale highlights.
 *
 * Density is a look call, not a physical measurement: at the first-pass value
 * of 10 the scales read as large plates rather than fish scales, so this was
 * doubled after visual review.
 */
export const BONY_FISH_SCALE_CONFIG: FishScaleConfig = {
  scalesPerLength: 20,
  edgeDarkness: 0.25,
  scaleGloss: 0.25,
};

/**
 * Crosswise scale cells for the barracuda's elongated body.
 *
 * Much denser than the small fish (60 vs 20) because this count is cells per
 * unit of *dorsoventral* span, and the barracuda is a long, narrow fish whose
 * body is far deeper than it is wide -- at the first-pass value of 6 the
 * scales were enormous slabs. Raised 10x after visual review.
 */
export const BARRACUDA_SCALE_CONFIG: FishScaleConfig = {
  scalesPerLength: 60,
  edgeDarkness: 0.15,
  scaleGloss: 0.2,
};

/**
 * Deliberate no-op for the shark. Sharks bear dermal denticles — tiny
 * tooth-like structures — not plate scales; a visible scale pattern at
 * typical tank render distance would be inaccurate. edgeDarkness=0 means
 * applyFishScaleShader returns without patching the material at all.
 */
export const SHARK_SCALE_CONFIG: FishScaleConfig = {
  scalesPerLength: 6,
  edgeDarkness: 0,
  scaleGloss: 0,
};

/**
 * Patches a MeshStandardMaterial with a procedural shingled fish-scale
 * pattern injected via onBeforeCompile.
 *
 * Visual model (Part 1 — overlap):
 *   Scales are shingled like roof tiles. Each scale's full circle has radius
 *   FISH_SCALE_RADIUS in normalised cell coordinates; because that radius
 *   exceeds 0.5, adjacent-row circles overlap. The "row above" (one cell
 *   toward the head) covers the head-facing portion of each scale, leaving
 *   only the tail-facing crescent (free edge) exposed. The crescent boundary
 *   follows the arc of the row-above circle, not a straight horizontal cut,
 *   so the result reads as natural shingled scales rather than circles or
 *   stripes. Alternate spine rows are staggered by half a cell (brick layout)
 *   so scale arcs interlock rather than lining up in a square grid.
 *
 * Visual model (Part 2 — reflectivity):
 *   roughnessFactor (a local float set by roughnessmap_fragment) is reduced
 *   at each scale centre so scales catch specular highlights. The reduction
 *   falls to zero at the scale edge and in gaps, keeping it subtle.
 *
 * Scale density: uFishScaleFreq is derived as config.scalesPerLength / zSpan,
 * where zSpan is the full dorsoventral (Z) extent of the body bounding box.
 * Using the Z span as reference gives isotropic cell sizes in world space —
 * a goldfish (zSpan ≈ 1.9 units) and a barracuda (zSpan ≈ 6.8 units) both
 * get physically appropriate absolute scale sizes.
 *
 * Pattern is evaluated in rest-space position (vFishScalePos = position
 * before undulation) so the scale pattern does not swim across the skin when
 * the fish body undulates (#219).
 *
 * Composes safely with fishUndulationShader: captures any existing
 * onBeforeCompile and calls it first via previousCompile?.(shader, renderer),
 * and augments customProgramCacheKey rather than replacing it. Scale patches
 * #include <color_vertex> (vertex) and #include <roughnessmap_fragment>
 * (fragment); undulation patches #include <begin_vertex> and
 * #include <beginnormal_vertex> — no overlap, either order works.
 *
 * GLSL safety: the injected fragment code writes only to diffuseColor (a
 * local vec4) and roughnessFactor (a local float). It never writes to vColor
 * or roughness: vColor is a read-only `in` under GLSL 300 ES (assigning to it
 * would fail with "l-value required"), and roughness is a uniform. Both
 * diffuseColor and roughnessFactor are mutable locals, assignable in all
 * GLSL versions three.js targets.
 */
export function applyFishScaleShader(
  material: THREE.MeshStandardMaterial,
  bodyGeometry: THREE.BufferGeometry,
  config: FishScaleConfig,
): void {
  if (config.edgeDarkness === 0) return;

  if (!bodyGeometry.boundingBox) bodyGeometry.computeBoundingBox();
  const bb = bodyGeometry.boundingBox!;
  // Drive frequency from the dorsoventral (Z) span so cell size is isotropic
  // in world space. A barracuda (Y span ≈ 36, Z span ≈ 6.8) and a goldfish
  // (Y span ≈ 3.2, Z span ≈ 1.9) both get the same cell size per world unit
  // for the same scalesPerLength value. Using max.y alone would give the
  // barracuda ≈2 crosswise cells (the Z span is ~5× shorter than Y span).
  const zSpan = Math.max(1e-6, bb.max.z - bb.min.z);
  const freq = config.scalesPerLength / zSpan;
  const cacheKey = `aiboids-fish-scale-v3:${freq.toFixed(5)}:${config.edgeDarkness.toFixed(4)}:${config.scaleGloss.toFixed(4)}`;

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
      `varying vec3 vFishScalePos;\n` + shader.vertexShader;
    // Capture the REST-space (pre-undulation) model position right before
    // vColor is set. Using the rest position means the scale pattern stays
    // fixed to the skin even as the body undulates (#219).
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      `vFishScalePos = position;\n#include <color_vertex>`,
    );

    // --- Fragment shader ---
    // Declare the varying (in) and uniforms at the top.
    shader.fragmentShader =
      `varying vec3 vFishScalePos;\nuniform float uFishScaleFreq;\nuniform float uScaleEdgeDarkness;\nuniform float uScaleGloss;\n` +
      shader.fragmentShader;

    // Inject the scale pattern AFTER roughnessmap_fragment. That chunk sets
    // roughnessFactor (a local float), which we can then reduce for gloss.
    // roughnessmap_fragment comes after color_fragment, so diffuseColor
    // already carries the folded-in vColor at this point.
    //
    // Both diffuseColor and roughnessFactor are mutable locals — writing to
    // them is valid in all GLSL versions. We never write to vColor (read-only
    // `in` in GLSL 300 ES) or to roughness (a uniform).
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
  {
    // Shingled arc scale pattern on the YZ body plane.
    // Y = spine axis (tail→head); Z = dorsal-ventral axis.
    // Alternate spine rows are staggered by half a cell (brick/hex layout)
    // so scale arcs interlock. Pattern uses rest-space vFishScalePos so it
    // does not swim with body undulation.
    vec2 sp = vec2( vFishScalePos.y, vFishScalePos.z ) * uFishScaleFreq;
    sp.y += floor( sp.x ) * 0.5;
    vec2 fp = fract( sp ) - 0.5;

    // Elliptical radius from this cell's scale centre, elongated on the
    // dorsoventral axis so the scales read as wider than tall.
    float r = length( vec2( fp.x, fp.y * 1.25 ) );
    // Elliptical radius to the row-above scale centre (one spine-cell toward
    // head). Where rAbove < kScaleR the current scale is hidden beneath the
    // row above, producing the shingled crescent rather than a full circle.
    float rAbove = length( vec2( fp.x + 1.0, fp.y * 1.25 ) );

    // Scale radius: > 0.5 so adjacent rows overlap and only a crescent is
    // exposed. Must match FISH_SCALE_RADIUS exported from fishScaleShader.ts.
    const float kScaleR = 0.62;

    // Smooth visibility mask: 1 = exposed crescent, 0 = hidden by row above.
    float visible = smoothstep( kScaleR - 0.04, kScaleR + 0.04, rAbove );

    // Free-edge arc: thin darkened band at the trailing boundary of the scale.
    float edge = smoothstep( kScaleR - 0.10, kScaleR, r )
               * ( 1.0 - smoothstep( kScaleR, kScaleR + 0.06, r ) );

    // --- Colour: darken the free edge of each exposed scale crescent ---
    diffuseColor.rgb *= 1.0 - uScaleEdgeDarkness * edge * visible;

    // --- Reflectivity: reduce roughness at scale centres for highlights ---
    // roughnessFactor is a local float (set by roughnessmap_fragment above);
    // it is safe to assign to it here.
    float scaleGloss = uScaleGloss * max( 0.0, 1.0 - r / kScaleR ) * visible;
    roughnessFactor = clamp( roughnessFactor - scaleGloss, 0.0, 1.0 );
  }`,
    );

    Object.assign(shader.uniforms, {
      uFishScaleFreq: { value: freq },
      uScaleEdgeDarkness: { value: config.edgeDarkness },
      uScaleGloss: { value: config.scaleGloss },
    });
  };

  material.needsUpdate = true;
}
