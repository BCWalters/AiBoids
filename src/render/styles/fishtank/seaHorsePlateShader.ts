import * as THREE from 'three';
import { patchMaterial } from '../../patchMaterial';

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
 * Composes safely with fishUndulationShader: installed via patchMaterial,
 * which chains onBeforeCompile and composes the cache key.
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
  const cacheKey = `aiboids-seahorse-plate-v2:${freq.toFixed(5)}:${config.ridgeDarkness.toFixed(4)}:${config.plateGloss.toFixed(4)}`;

  patchMaterial({
    material,
    cacheKey,
    patch: (shader) => {

      // --- Vertex shader ---
      // Declare the varying at the top so it survives Three.js's GLSL version
      // transform (varying → out in WebGL 2 / GLSL 300 ES).
      shader.vertexShader =
        `varying vec3 vSeaHorsePlatePos;\nvarying float vPlateSuppress;\nattribute float aPlateSuppress;\n` +
        shader.vertexShader;
      // Capture the REST-space (pre-undulation) model position right before
      // vColor is set. Using the rest position means the plate pattern stays
      // fixed to the skin even if body undulation is applied.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        `vSeaHorsePlatePos = position;\nvPlateSuppress = aPlateSuppress;\n#include <color_vertex>`,
      );

      // --- Fragment shader ---
      // Declare the varying (in) and uniforms at the top.
      shader.fragmentShader =
        `varying vec3 vSeaHorsePlatePos;\nvarying float vPlateSuppress;\nuniform float uPlateFreq;\nuniform float uPlateRidgeDarkness;\nuniform float uPlateGloss;\n` +
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
    if ( vPlateSuppress < 0.5 ) {
      // Seahorse trunk armour: segmented BONY RINGS.
      //
      // Y = spine axis (tail to head); Z = dorsoventral axis.
      //
      // The previous pattern darkened a thin line wherever EITHER axis crossed a
      // cell boundary. That draws a continuous lattice of straight lines in both
      // directions at once, which reads as a net laid over the skin rather than
      // as armour. Two things fix it: shade each plate as a raised SOLID instead
      // of outlining it, and break up the second axis so its seams never form
      // continuous straight lines.
      vec2 pp = vec2( vSeaHorsePlatePos.y, vSeaHorsePlatePos.z ) * uPlateFreq;

      // Rings are the dominant real feature, so they stay coherent: one band per
      // cell straight across the body.
      float ringCoord = pp.x;
      float ring = floor( ringCoord );

      // Facets around each ring are offset by a per-ring hash, so a facet seam on
      // one ring does not line up with the seam on its neighbour. This is what
      // stops the second axis reading as the other half of the net.
      float jitter = fract( sin( ring * 12.9898 ) * 43758.5453 );
      float facetCoord = pp.y * 0.62 + jitter;

      float fRing  = fract( ringCoord ) - 0.5;
      float fFacet = fract( facetCoord ) - 0.5;

      // Each plate is a shallow raised dome that falls away to its seam, rather
      // than a flat cell with a drawn border. Shading the interior is what makes
      // it read as a bony scute catching light.
      float ringBevel  = 1.0 - smoothstep( 0.24, 0.5, abs( fRing ) );
      float facetBevel = 1.0 - smoothstep( 0.30, 0.5, abs( fFacet ) );
      // Ring seams are cut deeper than facet seams, matching a real seahorse
      // where the segmentation along the spine is far more pronounced.
      float seam = 1.0 - ringBevel * mix( 0.55, 1.0, facetBevel );

      // --- Colour: a gradient into each seam, not a drawn line ---
      diffuseColor.rgb *= 1.0 - uPlateRidgeDarkness * seam;

      // --- Reflectivity: the crown of each plate is raised and glossier ---
      float crown = ringBevel * facetBevel;
      roughnessFactor = clamp( roughnessFactor - uPlateGloss * crown, 0.0, 1.0 );
    }`,
      );

      Object.assign(shader.uniforms, {
        uPlateFreq: { value: freq },
        uPlateRidgeDarkness: { value: config.ridgeDarkness },
        uPlateGloss: { value: config.plateGloss },
      });
    },
  });
}
