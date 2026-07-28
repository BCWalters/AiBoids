import * as THREE from 'three';
import { patchMaterial } from '../../patchMaterial';

export interface UnicornHairConfig {
  /**
   * Number of hair strands counted across the full body width (body X span).
   * Normalising to the body's own X span (not the narrower mane) keeps the
   * strand count consistent as the creature scales: at the shipped value of 25
   * roughly 7 strands are visible across the mane crest. The rest of the body
   * surface gets a finer coat texture at the same frequency.
   */
  strandsAcrossBodyWidth: number;
  /**
   * Number of along-strand clump cycles counted across the full body length
   * (body Y span). Roughly 2 clumps are visible along the mane at the shipped
   * value of 20. This ensures the Y coordinate actively contributes to the
   * pattern — without it the strands would be perfectly uniform parallel lines.
   */
  clumpsAlongBodyLength: number;
  /**
   * Darkness of the gap between adjacent strands.
   * 0 = no effect (skips patching entirely); 1 = fully black gap.
   */
  gapDarkness: number;
  /**
   * Darkness of the subtle shadow at clump boundaries along each strand.
   * 0 = no clumping; typically 0.1–0.3 for a natural feel.
   */
  clumpDarkness: number;
}

/**
 * Shipped defaults for the unicorn mane hair pattern.
 *
 * Strand width in world units (production unicorn, length=36, width=14.85):
 *   xSpan ≈ 2 × 0.85 × 14.85 × 0.4 ≈ 10.1 wu
 *   strandWidth ≈ 10.1 / 25 ≈ 0.40 wu
 *
 * Strands visible across the mane crest (max halfWidth ≈ 0.0975 × 14.85 ≈ 1.45 wu):
 *   maneXSpan / strandWidth ≈ 2.9 / 0.40 ≈ 7 strands
 */
export const UNICORN_HAIR_CONFIG: UnicornHairConfig = {
  strandsAcrossBodyWidth: 25,
  clumpsAlongBodyLength: 20,
  gapDarkness: 0.42,
  clumpDarkness: 0.18,
};

/**
 * Patches a MeshStandardMaterial with a procedural hair-strand pattern
 * injected via onBeforeCompile.
 *
 * Visual model:
 *   Individual hair strands run along the Y (neck/spine) axis. Strand
 *   separation is in the X (lateral) axis. Both axes vary across the mane
 *   crest geometry (X: ±maxHalfWidth; Y: withers → poll + forelock), so the
 *   2D lookup does not degenerate into stripes. This is the same planarity
 *   check that caught the dragon wing scale defect (see dragonScaleShader.ts's
 *   DragonScalePlane doc — 'yx' was required there for the flat wing panel for
 *   the same reason XY is correct here).
 *
 * Pattern co-ordinates use rest-space position (vUnicornHairPos = position
 * captured before any deformation in the vertex shader) so the texture stays
 * fixed to the skin at all times.
 *
 * Frequencies are normalised to the body geometry's X and Y bounding-box
 * spans (not the narrower mane crest geometry) for consistent strand width
 * at all creature scales: `strandsAcrossBodyWidth / xSpan` and
 * `clumpsAlongBodyLength / ySpan`.
 *
 * Composes safely with any previously-installed patch: installed via
 * patchMaterial, which chains onBeforeCompile and composes the cache key. On the
 * unicorn the body material also carries the horn's metal shading.
 *
 * GLSL safety: the injected fragment code writes only to diffuseColor (a
 * local vec4). It never writes to vColor: vColor is a read-only `in` under
 * GLSL 300 ES (assigning to it causes a "l-value required" link error that
 * blacks out the entire scene), and roughness is a uniform. diffuseColor is
 * a mutable local, assignable in all GLSL versions three.js targets.
 *
 * ⚠️  Clone-before-patch rule: THREE.Material.clone() silently drops both
 * onBeforeCompile and customProgramCacheKey. If the patched material is ever
 * cloned (e.g., for a separate per-side variant), clone FIRST and then call
 * applyUnicornHairShader on EACH clone independently. Never patch-then-clone.
 * This exact bug caused a "only one wing has the shader" defect in this repo
 * (see Renderer3D.ts where wingRightMaterial is cloned before patchWingMaterial
 * is called).
 */
export function applyUnicornHairShader(
  material: THREE.MeshStandardMaterial,
  bodyGeometry: THREE.BufferGeometry,
  config: UnicornHairConfig,
): void {
  if (config.gapDarkness === 0) return;

  if (!bodyGeometry.boundingBox) bodyGeometry.computeBoundingBox();
  const bb = bodyGeometry.boundingBox!;

  // Frequencies normalised to the body's own X and Y spans so strand width
  // scales consistently with the creature — the same approach as
  // applyDragonScaleShader's zSpan normalisation.
  const xSpan = Math.max(1e-6, bb.max.x - bb.min.x);
  const ySpan = Math.max(1e-6, bb.max.y - bb.min.y);
  const freqX = config.strandsAcrossBodyWidth / xSpan;
  const freqY = config.clumpsAlongBodyLength / ySpan;

  // freqX and freqY must both be in the cache key: three.js reuses a compiled
  // program whenever the key matches, so omitting either would silently reuse
  // the wrong program if frequencies change (e.g. at a different creature scale).
  const cacheKey = `aiboids-unicorn-hair-v2-manemask:${freqX.toFixed(5)}:${freqY.toFixed(5)}:${config.gapDarkness.toFixed(4)}:${config.clumpDarkness.toFixed(4)}`;

  patchMaterial({
    material,
    cacheKey,
    patch: (shader) => {

      // --- Vertex shader ---
      // Declare the varying at the top so it survives Three.js's GLSL version
      // transform (varying → out in WebGL 2 / GLSL 300 ES).
      // `aHairMask` is 1 on mane vertices and 0 everywhere else (set in
      // buildUnicornBodyGeometry). Three.js rewrites `attribute` -> `in` for
      // GLSL 300 ES across the whole vertex shader, so declaring it this way is
      // correct under both WebGL 1 and WebGL 2.
      shader.vertexShader =
        `varying vec3 vUnicornHairPos;\nvarying float vHairMask;\nattribute float aHairMask;\n` + shader.vertexShader;
      // Capture the REST-space (pre-deformation) model position right before
      // vColor is set. The rest position keeps the pattern fixed to the skin.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        `vUnicornHairPos = position;\nvHairMask = aHairMask;\n#include <color_vertex>`,
      );

      // --- Fragment shader ---
      // Declare the varying (in) and uniforms at the top.
      shader.fragmentShader =
        `varying vec3 vUnicornHairPos;\nvarying float vHairMask;\nuniform float uHairFreqX;\nuniform float uHairFreqY;\nuniform float uHairGapDarkness;\nuniform float uHairClumpDarkness;\n` +
        shader.fragmentShader;

      // Inject the hair pattern AFTER roughnessmap_fragment so diffuseColor
      // already carries the folded-in vColor at this point (color_fragment runs
      // before roughnessmap_fragment). diffuseColor is a mutable local — writing
      // to it is valid in all GLSL versions. We never write to vColor (read-only
      // `in` in GLSL 300 ES) or to roughness (a uniform).
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
    {
      // Procedural hair-strand pattern on the XY model-space plane.
      // X = across mane width (strand separation); Y = along neck (strand direction).
      // Both axes vary substantially across the mane crest geometry so this 2D
      // lookup does not degenerate into stripes.  Pattern uses rest-space
      // vUnicornHairPos so it stays fixed to the skin.

      // Fractional position within each strand cell.  The +0.5 offset centres
      // strand boundaries at ±0.5 so a strand midline falls at integer-X / freqX.
      float strandFrac = fract(vUnicornHairPos.x * uHairFreqX + 0.5) - 0.5;

      // Along-strand modulation in Y: a sinusoidal wave shifts each strand edge
      // by a small amount, breaking the uniformity of perfectly parallel lines
      // and ensuring the Y coordinate contributes to the rendered result.
      float alongY = vUnicornHairPos.y * uHairFreqY;
      strandFrac += sin(alongY * 6.28318) * 0.06;

      // Strand brightness mask: 1.0 inside the bright strand, 0.0 in the gap.
      const float kStrandHW = 0.30;
      float inStrand = 1.0 - smoothstep(kStrandHW - 0.08, kStrandHW + 0.06, abs(strandFrac));

      // Restrict the pattern to the mane. vHairMask is 1 on mane vertices and 0
      // on the body/head/legs, so the strand texture stops at the crest instead
      // of corrugating the entire creature.
      float maneMask = clamp(vHairMask, 0.0, 1.0);

      // Gap darkening: darker gaps between adjacent hair bundles.
      diffuseColor.rgb *= 1.0 - uHairGapDarkness * (1.0 - inStrand) * maneMask;

      // Subtle clump-boundary shadow along each strand at periodic Y intervals.
      float clumpShadow = (1.0 - smoothstep(0.3, 0.5, abs(fract(alongY * 0.5) - 0.5))) * inStrand;
      diffuseColor.rgb *= 1.0 - uHairClumpDarkness * clumpShadow * maneMask;
    }`,
      );

      Object.assign(shader.uniforms, {
        uHairFreqX: { value: freqX },
        uHairFreqY: { value: freqY },
        uHairGapDarkness: { value: config.gapDarkness },
        uHairClumpDarkness: { value: config.clumpDarkness },
      });
    },
  });
}
