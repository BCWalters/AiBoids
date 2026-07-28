import * as THREE from 'three';
import { patchMaterial } from '../../patchMaterial';

/**
 * Per-vertex strength attribute for the plumage pattern: 1 = full plumage,
 * 0 = no pattern at all (bare keratin such as the beak and eye).
 *
 * Intermediate values fade the pattern out smoothly. That matters wherever a
 * lathe collapses towards its axis: the pattern's second axis is a world
 * coordinate, so as the surface radius shrinks that coordinate stops varying
 * and the cells smear into lengthwise stripes. Fading the strength to 0 over
 * the collapsing region replaces the smear with clean skin instead.
 */
export const BIRD_FEATHER_MASK_ATTRIBUTE = 'aFeatherMask';

export interface BirdFeatherConfig {
  /**
   * Number of feather-barb cells across the reference span of the body
   * geometry.  For 'yz' plane (body / tail) the reference span is the
   * dorsoventral (Z) extent; for 'yx' plane (wings) it is the X span.
   * `uBarbFreq = barbsPerLength / referenceSpan`.  Using the dominant
   * axis of each mesh gives isotropic cell sizes in world space, matching
   * the approach used by fishScaleShader and dragonScaleShader.
   */
  barbsPerLength: number;
  /**
   * Darkness multiplier at each barb's trailing arc (free edge).
   * 0 = no effect (skips patching entirely); 1 = fully black edge.
   */
  barbDarkness: number;
  /**
   * Roughness reduction at each barb's centre.  0 = no highlight;
   * 1 = fully specular.  Keep subtle (0.10–0.20 reads as "soft sheen"
   * without turning birds into chrome).
   */
  barbGloss: number;
  /**
   * How many times longer each feather cell is along the spine axis than it is
   * across.  1 gives the round cells this shader originally used, which tile
   * into an unmistakable honeycomb — the "scale or tile floor" look.  Feathers
   * are long, narrow, overlapping blades, so values around 3–4 are what make
   * the pattern read as plumage at all.
   *
   * Implemented as a genuinely lower tiling frequency along the spine axis
   * rather than as a stretch inside the cell, so the cells are longer in world
   * space instead of merely being drawn as ellipses at the same pitch.
   */
  featherElongation: number;
  /**
   * Strength of the pale central shaft (rachis) drawn down each feather's long
   * axis.  0 disables it.  The shaft is the single strongest cue that a shape
   * is a feather rather than a scale, because scales have no midline.
   */
  barbRachis: number;
}

/**
 * Which model-space plane the feather cells are laid out in.
 *
 * The pattern is 2D, so BOTH of its axes must actually vary across the
 * surface being textured.  Y (the spine axis) always varies, so only the
 * second axis is selectable:
 *
 *  - 'yz' — for tube-like parts (body, tail), whose Z is the
 *            dorsoventral axis.  Frequency is derived from Z span.
 *  - 'yx' — for the near-flat wing panels that extend along X.
 *            Using 'yz' on a wing freezes the second coordinate and
 *            degenerates into lengthwise stripes instead of a pattern.
 *            Frequency is derived from X span.
 */
export type BirdFeatherPlane = 'yz' | 'yx';

/**
 * Feather barb config for the nature-scene birds (small birds, hawk, parrot).
 *
 * Feather barbs are finer than any fishtank scale and much finer than
 * dragon scales.  With the default small-bird body (Z span ≈ 4.7 wu),
 * barbsPerLength = 20 gives a cell ≈ 0.23 wu — well within the "fine"
 * calibration range noted in the design guide (goldfish ≈ 0.094 wu,
 * barracuda ≈ 0.113 wu, butterflyfish ≈ 0.448 wu).
 *
 * On the hawk (Z span ≈ 7.5 wu) the same value gives ≈ 0.37 wu; on the
 * parrot (Z span ≈ 6.2 wu) ≈ 0.31 wu — all clearly distinct from both
 * fish-scale and dragon-scale density.
 */
export const BIRD_FEATHER_CONFIG: BirdFeatherConfig = {
  barbsPerLength: 20,
  barbDarkness: 0.22,
  barbGloss: 0.18,
  featherElongation: 3.2,
  barbRachis: 0.16,
};

/**
 * Per-family feather configs. Issue #245 asks for *separate* textures for
 * small birds, hawks and parrots rather than one shared pattern, because the
 * three families read very differently in life:
 *
 *  - Small birds have fine, soft, low-contrast plumage.
 *  - Raptors have large, distinctly separated flight feathers with strong
 *    edge definition and a matte finish.
 *  - Parrots have tight, glossy, highly iridescent plumage.
 *
 * Note `barbsPerLength` is normalised against each creature's own span inside
 * applyBirdFeatherShader, so these numbers are directly comparable as
 * "barbs across the body" rather than as absolute cell sizes.
 */
export const SMALL_BIRD_FEATHER_CONFIG: BirdFeatherConfig = {
  barbsPerLength: 24,
  barbDarkness: 0.18,
  barbGloss: 0.14,
  // Softest, least defined plumage of the three: short downy body feathers.
  featherElongation: 2.6,
  barbRachis: 0.10,
};

export const HAWK_FEATHER_CONFIG: BirdFeatherConfig = {
  barbsPerLength: 14,
  barbDarkness: 0.30,
  barbGloss: 0.10,
  // Big, strongly separated flight feathers with hard edges: longest blades
  // and the most pronounced shaft of the three families.
  featherElongation: 4.0,
  barbRachis: 0.22,
};

export const PARROT_FEATHER_CONFIG: BirdFeatherConfig = {
  barbsPerLength: 22,
  barbDarkness: 0.20,
  barbGloss: 0.34,
  // Tight, glossy, strongly directional macaw plumage.
  featherElongation: 3.6,
  barbRachis: 0.18,
};

/**
 * Patches a MeshStandardMaterial with a procedural feather-barb pattern
 * injected via onBeforeCompile.
 *
 * Visual model:
 *   Bird feathers are overlapping, rounded barb vanes arranged in staggered
 *   rows (brick / hex layout) along the spine axis.  Each row's crescent is
 *   the tail-facing free edge exposed beneath the row above.  Unlike dragon
 *   scales the barbs carry no keel: birds must not look reptilian.  The edges
 *   are softer and wider than dragon-scale edges (0.20 vs 0.14 transition
 *   width) to evoke downy, fluffy plumage rather than hard reptilian plates.
 *
 * Pattern co-ordinates use rest-space position (vBirdFeatherPos = position
 * captured before any deformation in the vertex shader) so the feather
 * pattern stays fixed to the skin regardless of animation.
 *
 * Composes safely with any previously-installed patch: installed via
 * patchMaterial, which chains onBeforeCompile and composes the cache key.
 *
 * GLSL safety: the injected fragment code writes only to diffuseColor (a
 * local vec4) and roughnessFactor (a local float).  It never writes to vColor:
 * vColor is a read-only `in` under GLSL 300 ES (assigning to it would cause a
 * "l-value required" link error that blacks out the entire nature scene), and
 * roughness is a uniform.  Both diffuseColor and roughnessFactor are mutable
 * locals, assignable in all GLSL versions three.js targets.
 *
 * Frequency is derived from the dominant axis of the supplied geometry:
 *   - 'yz' plane → Z span (dorsoventral), for body / tail
 *   - 'yx' plane → X span (wing span), for near-flat wing panels
 * This prevents cell frequency from exploding when the reference axis nearly
 * vanishes (e.g. Z ≈ 0 on a flat wing in the XY plane).
 */
export function applyBirdFeatherShader(
  material: THREE.MeshStandardMaterial,
  bodyGeometry: THREE.BufferGeometry,
  config: BirdFeatherConfig,
  patternPlane: BirdFeatherPlane = 'yz',
): void {
  if (config.barbDarkness === 0) return;

  if (!bodyGeometry.boundingBox) bodyGeometry.computeBoundingBox();
  const bb = bodyGeometry.boundingBox!;
  // Drive frequency from the dominant axis of the chosen pattern plane.
  //   'yz' → dorsoventral Z span, like fishScaleShader / dragonScaleShader.
  //   'yx' → X span (wing span), so feathers scale with the wing rather than
  //          blowing up when Z ≈ 0 on a near-flat wing panel.
  const xSpan = Math.max(1e-6, bb.max.x - bb.min.x);
  const zSpan = Math.max(1e-6, bb.max.z - bb.min.z);
  const span = patternPlane === 'yz' ? zSpan : xSpan;
  const freq = config.barbsPerLength / span;
  // Feathers are long blades, not round scales. Tile the spine axis at a
  // proportionally LOWER frequency so each cell is `featherElongation` times
  // longer in world space than it is wide. Doing it with the frequency rather
  // than by stretching inside the cell is what actually changes the shape of
  // the tiling; stretching alone would keep the same pitch and still read as a
  // honeycomb, just a squashed one.
  const elongation = Math.max(1, config.featherElongation);
  const freqLong = freq / elongation;

  // patternPlane MUST be part of the cache key.  three.js reuses a compiled
  // program whenever the cache key matches, so omitting it would let the wing
  // silently reuse the body's program and collapse to stripes.  Every value
  // baked into the emitted GLSL or its uniforms belongs here for the same
  // reason — including the elongation and rachis added for the long-feather
  // pattern, or two families would share one compiled variant.
  const planeSwizzle =
    patternPlane === 'yz' ? 'vBirdFeatherPos.z' : 'vBirdFeatherPos.x';
  // Bare parts merged into a bird's body mesh — beak, eyes, cere — are keratin
  // and must not carry plumage, and regions where the surface collapses onto
  // the lathe axis must fade out before the cells smear into stripes. A
  // geometry controls both per-vertex by supplying a `aFeatherMask` attribute
  // (1 = full plumage, 0 = bare, in between = faded). The attribute cannot
  // simply be declared unconditionally: when a geometry lacks it the shader
  // would read 0 and the pattern would vanish from every bird, so its presence
  // has to gate the injected GLSL — and therefore also the cache key, or a
  // masked mesh would silently reuse an unmasked mesh's compiled program.
  const hasMask = bodyGeometry.getAttribute(BIRD_FEATHER_MASK_ATTRIBUTE) != null;
  const cacheKey =
    `aiboids-bird-feather-v2:${patternPlane}:${freq.toFixed(5)}:${freqLong.toFixed(5)}:` +
    `${config.barbDarkness.toFixed(4)}:${config.barbGloss.toFixed(4)}:` +
    `${config.barbRachis.toFixed(4)}:${hasMask ? 'masked' : 'full'}`;

  patchMaterial({
    material,
    cacheKey,
    patch: (shader) => {

      // --- Vertex shader ---
      // Declare the varying at the top so it survives Three.js's GLSL version
      // transform (varying → out in WebGL 2 / GLSL 300 ES).
      shader.vertexShader =
        `varying vec3 vBirdFeatherPos;\n` +
        (hasMask
          ? `attribute float ${BIRD_FEATHER_MASK_ATTRIBUTE};\nvarying float vBirdFeatherMask;\n`
          : '') +
        shader.vertexShader;
      // Capture the REST-space (pre-deformation) model position right before
      // vColor is set.  Using the rest position means the feather pattern stays
      // fixed to the skin regardless of any animation applied later.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        `vBirdFeatherPos = position;\n` +
          (hasMask ? `vBirdFeatherMask = ${BIRD_FEATHER_MASK_ATTRIBUTE};\n` : '') +
          `#include <color_vertex>`,
      );

      // --- Fragment shader ---
      // Declare the varying (in) and uniforms at the top.
      shader.fragmentShader =
        `varying vec3 vBirdFeatherPos;\nuniform float uBarbFreq;\nuniform float uBarbFreqLong;\nuniform float uBarbDarkness;\nuniform float uBarbGloss;\nuniform float uBarbRachis;\n` +
        (hasMask ? `varying float vBirdFeatherMask;\n` : '') +
        shader.fragmentShader;

      // Inject the feather pattern AFTER roughnessmap_fragment.  That chunk
      // sets roughnessFactor (a local float), which we can then reduce for
      // gloss.  roughnessmap_fragment comes after color_fragment, so
      // diffuseColor already carries the folded-in vColor at this point.
      //
      // Both diffuseColor and roughnessFactor are mutable locals — writing to
      // them is valid in all GLSL versions.  We never write to vColor (read-only
      // `in` in GLSL 300 ES) or to roughness (a uniform).
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
    {
      // Overlapping flight-feather pattern, staggered rows (brick layout).
      // Y = spine axis (tail->head) and is the feather's LONG axis; it is
      // tiled at uBarbFreqLong, a fraction of the cross-axis frequency, so
      // each cell is several times longer than it is wide.  Second axis =
      // dorsoventral (yz) or wing span (yx), chosen per mesh to avoid stripe
      // collapse on near-flat wing panels.  Uses rest-space vBirdFeatherPos.
      // Applied as a strength multiplier on each of the three pattern terms
      // rather than as a branch, so a geometry can fade the pattern out
      // gradually. At 0 every term contributes nothing, which is exactly what a
      // hard opt-out needs, so bare parts stay untouched either way.
      float featherStrength = ${hasMask ? 'clamp( vBirdFeatherMask, 0.0, 1.0 )' : '1.0'};
      vec2 sp = vec2( vBirdFeatherPos.y * uBarbFreqLong, ${planeSwizzle} * uBarbFreq );
      sp.y += floor( sp.x ) * 0.5;
      vec2 fp = fract( sp ) - 0.5;  // cell-local coords in [-0.5, 0.5]

      // Vane outline.  Slightly wider than tall in cell space on top of the
      // world-space elongation above, giving a blade that comes to a rounded
      // point rather than an even oval.
      float r      = length( vec2( fp.x * 0.86, fp.y ) );
      float rAhead = length( vec2( ( fp.x + 1.0 ) * 0.86, fp.y ) );

      // Vane radius > 0.5 so successive feathers overlap along their length,
      // exposing only the trailing part of each (the visible blade edge).
      const float kBarbR = 0.58;

      // Smooth visibility mask: 1 = exposed blade, 0 = hidden by the one ahead.
      float visible = smoothstep( kBarbR - 0.04, kBarbR + 0.04, rAhead );

      // Soft free-edge arc: wider than dragon scales (0.20 vs 0.14) so
      // feathers read as plumage rather than hard reptilian plates.
      float edge = smoothstep( kBarbR - 0.20, kBarbR, r )
                 * ( 1.0 - smoothstep( kBarbR, kBarbR + 0.10, r ) );

      // Rachis: the pale shaft running down the blade's midline.  Scales have
      // no midline, so this is the cue that most strongly separates "feather"
      // from "scale".  Confined to the exposed part of the vane and faded out
      // towards the tip so it does not run past the end of the blade.
      float rachis = ( 1.0 - smoothstep( 0.0, 0.10, abs( fp.y ) ) )
                   * ( 1.0 - smoothstep( kBarbR * 0.55, kBarbR, r ) )
                   * visible;

      // --- Colour: darken the trailing arc, lift the shaft ---
      // Writes only to diffuseColor (mutable local).  vColor is read-only in
      // GLSL 300 ES; assigning to it causes a link error that blacks the scene.
      diffuseColor.rgb *= 1.0 - uBarbDarkness * edge * visible * featherStrength;
      diffuseColor.rgb *= 1.0 + uBarbRachis * rachis * featherStrength;

      // --- Reflectivity: blade centres catch a gentle soft sheen ---
      float gloss = uBarbGloss * max( 0.0, 1.0 - r / kBarbR ) * visible * featherStrength;
      roughnessFactor = clamp( roughnessFactor - gloss, 0.0, 1.0 );
    }`,
      );

      Object.assign(shader.uniforms, {
        uBarbFreq: { value: freq },
        uBarbFreqLong: { value: freqLong },
        uBarbDarkness: { value: config.barbDarkness },
        uBarbGloss: { value: config.barbGloss },
        uBarbRachis: { value: config.barbRachis },
      });
    },
  });
}
