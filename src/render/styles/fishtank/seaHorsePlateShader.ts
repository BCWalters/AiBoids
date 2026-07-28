import * as THREE from 'three';

export interface SeaHorsePlateConfig {
  /**
   * Number of plate cells across the body's dorsoventral (Z) span.
   * `uPlateFreq = platesPerLength / zSpan` where `zSpan` is the full
   * dorsoventral extent of the body geometry bounding box. Using the Z span
   * gives isotropic cell sizes in world space, matching the approach used by
   * the fish scale shader.
   */
  platesPerLength: number;
  /**
   * Darkness multiplier at each plate's ridge seam (boundary between plates).
   * 0 = no effect (skips patching entirely); 1 = fully black seam.
   */
  ridgeDarkness: number;
  /**
   * Roughness reduction at each plate's centre, simulating a raised, slightly
   * reflective bony surface. 0 = flat; keep subtle (0.15–0.25 works well).
   */
  plateGloss: number;
}

/**
 * Bony-plate config for the fishtank sea horse.
 *
 * Seahorses lack scales; instead their bodies are armoured by a series of
 * connected bony plates (dermal scutes) that form a rough, bumpy surface with
 * a regular ridged pattern. The visual model is a regular grid of rectangular
 * plates with darkened seams at the boundaries and a slightly raised, glossier
 * centre on each plate.
 *
 * Plate density is deliberately coarser than any fish scale in the tank:
 * goldfish ≈ 0.094 wu, barracuda ≈ 0.113 wu, butterflyfish ≈ 0.448 wu.
 * At 30 plates per Z span on the seahorse body (Z span ≈ 23 world units),
 * each plate is ≈ 0.77 world units — clearly structural rather than fine-scaled.
 */
export const SEAHORSE_PLATE_CONFIG: SeaHorsePlateConfig = {
  platesPerLength: 30,
  ridgeDarkness: 0.35,
  plateGloss: 0.20,
};

/**
 * Patches a MeshStandardMaterial with a procedural bony-plate pattern
 * injected via onBeforeCompile.
 *
 * Visual model:
 *   Seahorse bodies are armoured by connected bony dermal scutes — a regular
 *   grid of roughly rectangular plates. Unlike fish scales, these plates do
 *   NOT overlap: each plate has a flat raised surface with a dark ridge seam
 *   at every boundary. The pattern uses a regular (non-staggered) grid to
 *   read as structural armour rather than overlapping scales.
 *
 * Pattern co-ordinates use rest-space position (vSeaHorsePlatePos = position
 * captured before undulation in the vertex shader) so the plate pattern does
 * not swim across the skin if undulation is ever applied.
 *
 * Composes safely with fishUndulationShader: captures any existing
 * onBeforeCompile and calls it first, and augments customProgramCacheKey
 * rather than replacing it.
 *
 * GLSL safety: the injected fragment code writes only to diffuseColor (a
 * local vec4) and roughnessFactor (a local float). It never writes to vColor:
 * vColor is a read-only `in` under GLSL 300 ES (assigning to it would fail
 * with "l-value required"), and roughness is a uniform. Both diffuseColor and
 * roughnessFactor are mutable locals, assignable in all GLSL versions.
 */
export function applySeaHorsePlateShader(
  material: THREE.MeshStandardMaterial,
  bodyGeometry: THREE.BufferGeometry,
  config: SeaHorsePlateConfig,
): void {
  if (config.ridgeDarkness === 0) return;

  if (!bodyGeometry.boundingBox) bodyGeometry.computeBoundingBox();
  const bb = bodyGeometry.boundingBox!;
  // Drive frequency from the dorsoventral (Z) span, matching the approach
  // used by the fish scale shader. The seahorse body's Z span represents its
  // full front-to-back (belly-to-dorsal) extent, giving isotropic cell sizes
  // in world space regardless of body proportions.
  const zSpan = Math.max(1e-6, bb.max.z - bb.min.z);
  const freq = config.platesPerLength / zSpan;
  const cacheKey = `aiboids-seahorse-plate-v1:${freq.toFixed(5)}:${config.ridgeDarkness.toFixed(4)}:${config.plateGloss.toFixed(4)}`;

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
      `varying vec3 vSeaHorsePlatePos;\n` + shader.vertexShader;
    // Capture the REST-space (pre-undulation) model position right before
    // vColor is set. Using the rest position means the plate pattern stays
    // fixed to the skin even if body undulation is applied.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      `vSeaHorsePlatePos = position;\n#include <color_vertex>`,
    );

    // --- Fragment shader ---
    // Declare the varying (in) and uniforms at the top.
    shader.fragmentShader =
      `varying vec3 vSeaHorsePlatePos;\nuniform float uPlateFreq;\nuniform float uPlateRidgeDarkness;\nuniform float uPlateGloss;\n` +
      shader.fragmentShader;

    // Inject the plate pattern AFTER roughnessmap_fragment. That chunk sets
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
    // Regular bony-plate pattern on the YZ body plane.
    // Y = spine axis (tail→head); Z = dorsal-ventral axis.
    // No row stagger: plates form a regular grid to read as structural
    // armour rather than overlapping scales.
    vec2 pp = vec2( vSeaHorsePlatePos.y, vSeaHorsePlatePos.z ) * uPlateFreq;
    vec2 fp = fract( pp ) - 0.5;  // cell-local coords in [-0.5, 0.5]

    // Distance from nearest plate edge (0 at boundary, 0.5 at cell centre).
    float distFromEdge = min( abs( fp.x ), abs( fp.y ) );

    // Ridge: darkened seam at each plate boundary.
    // kRidgeHW is the half-width of the seam in normalised cell coords.
    const float kRidgeHW = 0.10;
    float ridge = 1.0 - smoothstep( 0.0, kRidgeHW, distFromEdge );

    // --- Colour: darken the ridge seam between plates ---
    diffuseColor.rgb *= 1.0 - uPlateRidgeDarkness * ridge;

    // --- Reflectivity: each plate centre is slightly raised and glossier ---
    // Chebyshev distance from cell centre (0 at centre, 0.5 at corner/edge).
    float distFromCentre = max( abs( fp.x ), abs( fp.y ) );
    float bump = max( 0.0, 1.0 - distFromCentre / 0.45 );
    roughnessFactor = clamp( roughnessFactor - uPlateGloss * bump, 0.0, 1.0 );
  }`,
    );

    Object.assign(shader.uniforms, {
      uPlateFreq: { value: freq },
      uPlateRidgeDarkness: { value: config.ridgeDarkness },
      uPlateGloss: { value: config.plateGloss },
    });
  };

  material.needsUpdate = true;
}
