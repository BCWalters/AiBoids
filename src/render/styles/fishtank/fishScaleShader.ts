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
   * Darkness multiplier applied at each scale's trailing arc edge.
   * 0 = no effect (skips patching entirely); 1 = fully black edge.
   */
  edgeDarkness: number;
}

/**
 * Bony plate scales for small fish (Tetra, Goldfish, Clownfish, Blue Tang)
 * and Butterflyfish. Ten visible scale cells across the dorsoventral (Z) body
 * span, with a quarter-darkened arc rim.
 */
export const BONY_FISH_SCALE_CONFIG: FishScaleConfig = {
  scalesPerLength: 10,
  edgeDarkness: 0.25,
};

/** Six crosswise scale cells for the barracuda's elongated body. */
export const BARRACUDA_SCALE_CONFIG: FishScaleConfig = {
  scalesPerLength: 6,
  edgeDarkness: 0.15,
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
};

/**
 * Patches a MeshStandardMaterial with a procedural fish-scale pattern
 * injected via onBeforeCompile. The scale effect multiplies into the
 * existing vertex colour — it never replaces it, so species colour patterns
 * (clownfish bands, blue-tang flank mark, goldfish countershading) are
 * fully preserved.
 *
 * Scale density proportional to fish body: uFishScaleFreq is derived as
 * config.scalesPerLength / zSpan, where zSpan is the full dorsoventral (Z)
 * extent of the body bounding box. Using the Z span as reference gives
 * isotropic cell sizes in world space — a goldfish (zSpan ≈ 1.9 units) and
 * a barracuda (zSpan ≈ 6.8 units) both get physically appropriate absolute
 * scale sizes rather than cell counts that blow up on one axis.
 *
 * Composes safely with fishUndulationShader: captures any existing
 * onBeforeCompile and calls it first via previousCompile?.(shader, renderer),
 * and augments customProgramCacheKey rather than replacing it. Scale patches
 * #include <color_vertex> (vertex) and #include <color_fragment> (fragment);
 * undulation patches #include <begin_vertex> and #include <beginnormal_vertex>
 * — no overlap, either order works.
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
  const cacheKey = `aiboids-fish-scale-v2:${freq.toFixed(5)}:${config.edgeDarkness.toFixed(4)}`;

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
    // Capture the model-space position right before vColor is set so both
    // are available in the fragment shader without UV dependency.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      `vFishScalePos = position;\n#include <color_vertex>`,
    );

    // --- Fragment shader ---
    // Declare the varying (in) and uniforms at the top.
    shader.fragmentShader =
      `varying vec3 vFishScalePos;\nuniform float uFishScaleFreq;\nuniform float uScaleEdgeDarkness;\n` +
      shader.fragmentShader;
    // Modulate the pattern into diffuseColor *after* color_fragment has
    // folded vColor in. It must not touch vColor itself: three.js upgrades
    // these shaders to GLSL 300 ES, where `varying` becomes `in` in the
    // fragment stage and inputs are read-only — assigning to vColor fails to
    // link with "l-value required (can't modify an input)" and takes the whole
    // scene down. diffuseColor is a local vec4, so it is assignable, and
    // because both are componentwise multiplies the result is identical.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  {
    // Overlapping-arc scale pattern on the YZ body plane.
    // Y = spine axis (tail to head); Z = dorsal-ventral axis.
    // Offset alternating spine columns by half a cell so the shingles
    // stagger the way real fish scales do.
    vec2 sp = vec2( vFishScalePos.y, vFishScalePos.z ) * uFishScaleFreq;
    sp.y += floor( sp.x ) * 0.5;
    vec2 fp = fract( sp ) - 0.5;
    // Thin elliptical rim, elongated along the spine (fp.x) to match the
    // orientation of real scales. Measured over a unit cell, 71.7% of the
    // surface is untouched and the mean multiplier is 0.962, so this reads
    // as scale edges rather than darkening the whole fish.
    float r = length( vec2( fp.x, fp.y * 1.6 ) );
    float rim = smoothstep( 0.34, 0.44, r ) * ( 1.0 - smoothstep( 0.44, 0.52, r ) );
    diffuseColor.rgb *= 1.0 - uScaleEdgeDarkness * rim;
  }`,
    );

    Object.assign(shader.uniforms, {
      uFishScaleFreq: { value: freq },
      uScaleEdgeDarkness: { value: config.edgeDarkness },
    });
  };

  material.needsUpdate = true;
}
