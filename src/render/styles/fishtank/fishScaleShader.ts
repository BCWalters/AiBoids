import * as THREE from 'three';

/**
 * Configuration for the procedural fish scale shader applied to a
 * MeshStandardMaterial via onBeforeCompile.
 *
 * Scale density is expressed as *scales per body half-length* so the
 * physical scale size scales proportionally with the creature: a
 * goldfish and a large shark both end up with a consistent 5–7% scale-to-
 * body-length ratio rather than the same absolute cell size in world space.
 */
export interface FishScaleConfig {
  /**
   * How many scale rows fit within one body half-length (tail–nose distance
   * measured from the origin to the tip). 10 ≈ 20 rows across the full body —
   * a natural, visible scale pattern without being too dense or too coarse.
   */
  scalesPerLength: number;
  /**
   * Fraction of scale-edge darkening applied to diffuseColor at each arc
   * boundary (0 = no effect, 1 = solid black).  0.22 gives a subtle but
   * legible scale silhouette that reads over the baked species colour
   * patterns without obscuring them.
   */
  edgeDarkness: number;
}

// ---------------------------------------------------------------------------
// Per-species scale configs
// ---------------------------------------------------------------------------

/**
 * Bony fish (Tetra / Goldfish / Clownfish / Blue Tang / Butterflyfish):
 * a natural overlapping-arc scale pattern at moderate density and darkness.
 */
export const BONY_FISH_SCALE_CONFIG: FishScaleConfig = {
  scalesPerLength: 10,
  edgeDarkness: 0.22,
};

/**
 * Barracuda: real barracuda have fine cycloid scales; slightly lower density
 * and darkness than the small bony fish (the body reads as smooth and shiny).
 */
export const BARRACUDA_SCALE_CONFIG: FishScaleConfig = {
  scalesPerLength: 8,
  edgeDarkness: 0.12,
};

/**
 * Shark: sharks have *dermal denticles* (placoid scales — tiny tooth-like
 * structures) that are not visible as plate scales at typical render distances.
 * Excluded by design: edgeDarkness=0 means the whole pattern evaluates to
 * a multiply-by-1.0 no-op; the customProgramCacheKey still captures it so
 * shader permutations are not confused with other configs.
 */
export const SHARK_SCALE_CONFIG: FishScaleConfig = {
  scalesPerLength: 0,
  edgeDarkness: 0,
};

// ---------------------------------------------------------------------------
// GLSL snippets
// ---------------------------------------------------------------------------

/**
 * Vertex-shader preamble: the varying that carries model-space position from
 * vertex to fragment stage so the scale coordinates can be computed without
 * world-space transforms (keeping the pattern anchored to the fish anatomy).
 */
const VERTEX_VARYING_DECL = `varying vec3 vFishScalePos;\n`;

/**
 * Fragment-shader preamble: the matching varying declaration plus the two
 * uniforms that control scale density and intensity.
 */
const FRAGMENT_PREAMBLE = `\
varying vec3 vFishScalePos;
uniform float uFishScaleFreq;
uniform float uFishScaleEdgeDark;
`;

/**
 * The fish scale pattern is injected immediately after THREE.js's own
 * `#include <color_fragment>` chunk (which reads vColor into diffuseColor).
 * We multiply diffuseColor.rgb by (1 - darkness) so the result is always
 * a darker version of the species' own baked colour — never a replacement.
 *
 * Algorithm: overlapping circular arcs in a brick-staggered grid.
 *   scaleV — body-axis direction, with one unit = one scale row
 *   scaleU — circumferential direction, 8 columns per revolution
 *
 * Each cell (scaleU, scaleV) represents one scale tile.  The visible arc is
 * the lower edge of the scale sitting on top, whose geometry is a circle
 * centred above the cell and only shown in the lower band of the tile.
 */
const FRAGMENT_SCALE_INJECTION = `\
#include <color_fragment>
#if defined( USE_COLOR )
{
  // ── Fish scale modulation ────────────────────────────────────────────────
  // Cylindrical coordinates from the model-space position interpolated at
  // this fragment.  theta spans –PI..+PI around the body axis (+Y).
  float fsTheta   = atan( vFishScalePos.x, vFishScalePos.z );
  float fsScaleU  = ( fsTheta / 6.2832 + 0.5 ) * 8.0;     // 8 columns / rev
  float fsScaleV  = vFishScalePos.y * uFishScaleFreq;       // rows along body

  // Brick stagger: offset every other row by half a cell.
  float fsRow     = floor( fsScaleV );
  float fsOffsetU = mod( fsRow, 2.0 ) * 0.5;
  vec2  fsCell    = vec2( fract( fsScaleU + fsOffsetU ), fract( fsScaleV ) );

  // Scale-edge arc: centre above cell at (0.5, 1.30), radius 1.15.
  // At the cell centre x=0.5 the arc bottom sits at y ≈ 0.15; at x=0 or 1
  // it rises to y ≈ 0.27 — a gentle concave-downward curve mimicking the
  // lower boundary of a real fish scale that overlaps from above.
  vec2  fsArcCtr  = vec2( 0.5, 1.30 );
  float fsDist    = distance( fsCell, fsArcCtr );
  float fsArcR    = 1.15;
  float fsArcW    = 0.09;
  // Thin ring band around the arc radius.
  float fsArcDark = smoothstep( fsArcW, 0.0, abs( fsDist - fsArcR ) );
  // Only the lower portion of the arc is visible (the upper half is covered
  // by the scale above it in a real fish).
  fsArcDark *= smoothstep( 0.55, 0.10, fsCell.y );

  // Apply: darken diffuseColor without clamping the baked species colours.
  diffuseColor.rgb *= 1.0 - fsArcDark * uFishScaleEdgeDark;
}
#endif
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Patches `material.onBeforeCompile` to add a procedural overlapping-arc
 * fish scale pattern that modulates the existing vertex colour.
 *
 * **Composition with other shaders** (e.g. the undulation shader from #220):
 * The previous `onBeforeCompile` is saved and called first inside the new
 * callback, so all prior patches survive.  `customProgramCacheKey` chains
 * the previous key so Three.js generates distinct shader programs for every
 * unique combination of patches.
 *
 * @param material   The body MeshStandardMaterial to patch (must have
 *                   `vertexColors: true` so the scale modulation applies to
 *                   the species' baked colour attribute, not to plain white).
 * @param config     Per-species density and darkness settings.
 * @param bodyHalfLen  Y-extent of the body geometry (head − tail / 2), used
 *                   to derive `uFishScaleFreq` so the scale size is
 *                   proportional to the fish rather than to world space.
 */
export function applyFishScaleShader(
  material: THREE.MeshStandardMaterial,
  config: FishScaleConfig,
  bodyHalfLen: number,
): void {
  // A zero edgeDarkness config means no visible effect — still chain the key
  // so shader permutations are correctly cached.
  const scaleFreq = bodyHalfLen > 1e-6
    ? config.scalesPerLength / bodyHalfLen
    : 0;

  // ── Cache-key chaining ──────────────────────────────────────────────────
  // Incorporate the previous key (e.g. the undulation shader's) so
  // Three.js generates a distinct program for every unique patch combination.
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => {
    const prev = previousCacheKey?.() ?? '';
    return `fish-scale-v1:${config.scalesPerLength}:${config.edgeDarkness.toFixed(3)}:${prev}`;
  };

  // ── onBeforeCompile chaining ─────────────────────────────────────────────
  // Save any prior callback (e.g. the fish-undulation shader) and call it
  // first so its vertex/fragment patches are applied before ours.
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    // 1. Apply any prior patch (undulation, etc.) first.
    previousCompile?.(shader, renderer);

    // 2. Inject uniforms.
    shader.uniforms['uFishScaleFreq'] = { value: scaleFreq };
    shader.uniforms['uFishScaleEdgeDark'] = { value: config.edgeDarkness };

    // 3. Vertex shader: declare varying + assign model-space position.
    //    We prepend the declaration and inject the assignment *after*
    //    #include <color_vertex> — a chunk that is not patched by the
    //    undulation shader, so there is no overlap or double-replacement.
    shader.vertexShader = VERTEX_VARYING_DECL + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      '#include <color_vertex>\nvFishScalePos = position;',
    );

    // 4. Fragment shader: declare varying + uniforms + inject scale math.
    //    We replace #include <color_fragment> with a block that includes
    //    the original chunk then appends our scale modulation.
    shader.fragmentShader = FRAGMENT_PREAMBLE + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      FRAGMENT_SCALE_INJECTION,
    );
  };

  material.needsUpdate = true;
}
