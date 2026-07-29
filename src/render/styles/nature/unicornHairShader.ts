import * as THREE from 'three';
import { patchMaterial } from '../../patchMaterial';

export interface UnicornHairConfig {
  /**
   * Number of hair strands counted across the full body width (body X span).
   * Normalising to the body's own X span (not the narrower mane) keeps the
   * strand count consistent as the creature scales: at the shipped value of 25
   * roughly 7 strands are visible across the mane crest.
   *
   * This applies to the MANE ONLY — the strand pattern is masked to mane
   * vertices via `aHairMask`. The body surface is textured separately by
   * `coatStrandsAroundBody` below.
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
  /**
   * Horse coat texture on the BODY (everywhere `aHairMask` is 0).
   *
   * Deliberately a separate, much higher frequency than the mane: an earlier
   * revision ran the mane's strand pattern unmasked across the whole creature
   * and it read as corrugation rather than hair, which is why the mane mask
   * was introduced. A real coat is short, fine, and near-uniform — closer to a
   * sheen than to strands — so this wants a high count and a very low
   * darkness.
   */
  coatStrandsAroundBody: number;
  /**
   * Number of along-body waver cycles over the body's Y span, so the coat
   * strands are not perfectly straight rings around the barrel.
   */
  coatWaversAlongBody: number;
  /**
   * Contrast of the body coat. Very low by design (~0.03–0.08): high enough to
   * catch the light and break up a flat lavender surface, low enough that it
   * never reads as stripes. 0 skips the coat entirely.
   */
  coatDarkness: number;
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
  coatStrandsAroundBody: 150,
  coatWaversAlongBody: 26,
  coatDarkness: 0.07,
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
  // theta is already normalised to [0,1) around the barrel, so the strand
  // count is used directly — no span division. The along-body waver still
  // normalises to ySpan so it scales with the creature.
  const coatStrands = config.coatStrandsAroundBody;
  const coatFreqY = config.coatWaversAlongBody / ySpan;

  // freqX and freqY must both be in the cache key: three.js reuses a compiled
  // program whenever the key matches, so omitting either would silently reuse
  // the wrong program if frequencies change (e.g. at a different creature scale).
  const cacheKey = `aiboids-unicorn-hair-v4-cylcoat:${coatStrands.toFixed(5)}:${coatFreqY.toFixed(5)}:${config.coatDarkness.toFixed(4)}:${freqX.toFixed(5)}:${freqY.toFixed(5)}:${config.gapDarkness.toFixed(4)}:${config.clumpDarkness.toFixed(4)}`;

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
        `varying vec3 vUnicornHairPos;\nvarying float vHairMask;\nuniform float uHairFreqX;\nuniform float uHairFreqY;\nuniform float uHairGapDarkness;\nuniform float uHairClumpDarkness;\nuniform float uCoatStrands;\nuniform float uCoatFreqY;\nuniform float uCoatDarkness;\n` +
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

      // --- Body coat (everywhere the mane is not) ---
      // Much finer and far lower contrast than the mane.
      //
      // Uses CYLINDRICAL coordinates, not the mane's flat XY plane. The mane
      // is a narrow crest where X varies fast across its width, so a planar
      // fract(x) reads as clean strands there. The barrel does not behave that
      // way: X turns over and mirrors about x = 0, so on the flanks — where the
      // surface is nearly parallel to X — the same lookup collapses into wide
      // bands that meet in a diamond at the centreline and radiate outward.
      // This is the same planarity failure as the dragon wing (see
      // dragonScaleShader.ts's DragonScalePlane doc), just on a curved surface
      // instead of a flat one.
      //
      // Wrapping the separation around the barrel's circumference via
      // atan(x, z) instead makes the coordinate advance smoothly all the way
      // around the body, so strand density is even on the flanks, back and
      // neck alike, with no mirror seam.
      float bodyMask = 1.0 - maneMask;
      // Angle around the body's long (Y) axis, normalised to [0,1). Strand
      // separation runs around the barrel; strand direction runs along Y.
      float theta = atan(vUnicornHairPos.x, vUnicornHairPos.z) / 6.28318 + 0.5;
      float coatFrac = fract(theta * uCoatStrands) - 0.5;
      // Along-body waver so the strands are not perfectly straight rings.
      coatFrac += sin(vUnicornHairPos.y * uCoatFreqY) * 0.10;
      float coatFine = 1.0 - smoothstep(0.16, 0.34, abs(coatFrac));
      // Second octave along the body length, at an unrelated multiple so the
      // two never align into a visible repeat.
      float coatFrac2 = fract(vUnicornHairPos.y * uCoatFreqY * 0.61 + 0.25) - 0.5;
      float coatOct2 = 1.0 - smoothstep(0.20, 0.40, abs(coatFrac2));
      float coat = mix(coatFine, coatFine * 0.5 + coatOct2 * 0.5, 0.45);
      diffuseColor.rgb *= 1.0 - uCoatDarkness * (1.0 - coat) * bodyMask;
    }`,
      );

      Object.assign(shader.uniforms, {
        uHairFreqX: { value: freqX },
        uHairFreqY: { value: freqY },
        uHairGapDarkness: { value: config.gapDarkness },
        uHairClumpDarkness: { value: config.clumpDarkness },
        uCoatStrands: { value: coatStrands },
        uCoatFreqY: { value: coatFreqY },
        uCoatDarkness: { value: config.coatDarkness },
      });
    },
  });
}
