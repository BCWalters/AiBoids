import * as THREE from 'three';

/**
 * Configuration for the wing-undulation vertex-shader displacement.
 *
 * Instead of the whole wing panel rotating as a rigid plate about the shoulder,
 * a traveling wave is injected in the vertex shader so the flap stroke propagates
 * from shoulder to tip: the tip lags the root by `tipPhaseLagRad` radians, producing
 * the characteristic flex rather than a flat-panel flip.
 *
 * Both amplitude values are expressed as fractions of the wing's spanwise extent
 * (shoulder to tip) so the effect scales automatically with creature size.
 *
 * Normals ARE corrected for the displacement, analytically. Because the
 * displacement is a heightfield in a single variable (`z += w(x)`), the exact
 * corrected normal is available in closed form — see {@link normalSnippet} —
 * so there is no need to finite-difference or to rebuild normals on the CPU.
 * Before that correction existed the amplitude was capped at a few per cent of
 * span, because the lighting error grows with the deflection and grows
 * DIFFERENTLY per creature: the small bird's wing is a zero-thickness flat
 * panel while the dragon's is a thin solid with struts.
 */
export interface WingUndulationConfig {
  /**
   * Undulation amplitude as a fraction of the spanwise half-extent
   * (0 = shoulder, 1 = tip). A value of 0.06 displaces the tip by
   * about 6 % of span in the dorsal (Z) direction at peak stroke.
   */
  amplitudeFraction: number;
  /**
   * Phase lag accumulated from shoulder to tip, in radians.
   * π * 0.6 ≈ 108° means the tip is always lagging the shoulder by
   * slightly more than a quarter-cycle — the shoulder is already on its
   * way back up while the tip is still reaching its peak.
   */
  tipPhaseLagRad: number;
  /**
   * How hard the wave is squared up, as `tanh(k·sin θ) / tanh(k)`.
   *
   * 0 (the default) leaves a plain sine, which is what the fish fins want — a
   * smooth continuous scull. Raising it makes the tip dwell near its extremes
   * and cross between them faster, which raises peak tip *speed* without
   * bending the wing any further. That speed is what reads as a slap; simply
   * increasing the amplitude reads as a wider bow instead.
   *
   * ### Why tanh and not `sign(w)·|w|^p`
   * The exponent form is the obvious way to square up a sine, and it is wrong
   * here. Its slope `p·|sin θ|^(p−1)·cos θ` diverges as the wave crosses zero,
   * so the analytic normal correction — which is built on that slope — spikes
   * on the exact band of the wing where the wave is crossing. That paints a
   * bright seam sweeping outward along the span every half-stroke, and it gets
   * WORSE the finer the mesh, so it would have grown as wings were subdivided.
   * An epsilon clamp only caps the spike (still ~35× at 1e-4) rather than
   * removing it. tanh is smooth, monotone and has slope bounded by k/tanh(k)
   * everywhere, so no clamp is needed and there is no seam to cap.
   */
  slapSharpness?: number;
}

/** `slapSharpness` value that leaves the wave a plain sine. */
export const UNSHAPED_WAVE = 0;

/** Returned by applyWingUndulationShader; held in BoidRenderBatch and updated
 * every frame by CreatureInstanceRenderer so the GPU sees current per-instance
 * flap phases. */
export interface WingUndulationInstanceState {
  /** Per-instance flap phase (radians). Written by the renderer each frame
   * and read by the vertex shader. Both wing meshes share the same buffer. */
  phaseAttribute: THREE.InstancedBufferAttribute;
}

// ---- GLSL helpers injected into the vertex shader ----

/**
 * The undulation displacement, in TypeScript.
 *
 * This mirrors {@link vertexDisplacementSnippet} exactly, and exists so that
 * geometry tests can ask "where does this vertex actually end up mid-flap?"
 * without a GPU. Anything changed in one must be changed in the other; the
 * pairing follows the same arrangement as `sampleFishUndulationDisplacement`.
 */
export function sampleWingUndulationDisplacement({
  x,
  root,
  span,
  amplitude,
  waveNumber,
  phase,
  slapSharpness = UNSHAPED_WAVE,
}: {
  x: number;
  root: number;
  span: number;
  amplitude: number;
  waveNumber: number;
  phase: number;
  slapSharpness?: number;
}): number {
  if (span <= 1e-6) return 0;
  const t = Math.min(1, Math.max(0, (Math.abs(x) - root) / span));
  const envelope = t * t * (3 - 2 * t);
  return amplitude * envelope * shapeWave(Math.sin(phase - waveNumber * t), slapSharpness);
}

/** `tanh(k·s) / tanh(k)`, the wave-shaping used by both the GLSL and this mirror. */
function shapeWave(s: number, k: number): number {
  if (k <= UNSHAPED_WAVE) return s;
  return Math.tanh(k * s) / Math.tanh(k);
}

/** d/ds of {@link shapeWave}. `sech²(x) = 1 − tanh²(x)`. */
function shapeWaveSlope(s: number, k: number): number {
  if (k <= UNSHAPED_WAVE) return 1;
  const t = Math.tanh(k * s);
  return (k * (1 - t * t)) / Math.tanh(k);
}

/**
 * d(displacement)/dx, in TypeScript — the mirror of {@link normalSnippet}, and
 * the quantity the shader needs to correct the normal.
 *
 * The displacement is `w(x) = A · env(t) · S(θ)` with `t = clamp((|x| − root)/span, 0, 1)`
 * and `θ = phase − k·t`, so by the chain rule
 *
 * ```
 * dw/dx = A · [ env'(t)·S(θ) − k·env(t)·S'(θ) ] · dt/dx
 * env'(t) = 6t(1 − t)          S'(θ) = p·|sin θ|^(p−1)·cos θ
 * ```
 *
 * `dt/dx = sign(x)/span` — except where the clamp is active, where it is 0.
 * Outboard of the tip and inboard of the root the surface is flat again, so
 * leaving the clamp out would tilt the normal on a piece of geometry that has
 * not moved.
 */
export function sampleWingUndulationSlope({
  x,
  root,
  span,
  amplitude,
  waveNumber,
  phase,
  slapSharpness = UNSHAPED_WAVE,
}: {
  x: number;
  root: number;
  span: number;
  amplitude: number;
  waveNumber: number;
  phase: number;
  slapSharpness?: number;
}): number {
  if (span <= 1e-6) return 0;
  const raw = (Math.abs(x) - root) / span;
  if (raw <= 0 || raw >= 1) return 0;
  const t = raw;
  const theta = phase - waveNumber * t;
  const sinTheta = Math.sin(theta);
  const envelope = t * t * (3 - 2 * t);
  const envelopeSlope = 6 * t * (1 - t);
  const wave = shapeWave(sinTheta, slapSharpness);
  // Chain rule through the shaping: d/dθ S(sin θ) = S'(sin θ) · cos θ.
  const waveSlope = shapeWaveSlope(sinTheta, slapSharpness) * Math.cos(theta);
  const dwdt = amplitude * (envelopeSlope * wave - waveNumber * envelope * waveSlope);
  return (dwdt * Math.sign(x)) / span;
}

function vertexDeclarations(): string {
  return `
attribute float wingUndulationPhase;
uniform float uWingRoot;
uniform float uWingSpan;
uniform float uWingUndulationAmplitude;
uniform float uWingUndulationWaveNumber;
uniform float uWingSlapSharpness;

// tanh(k*s) / tanh(k). Needs no epsilon guard: it is smooth everywhere and its
// slope is bounded by k/tanh(k), unlike sign(s)*pow(abs(s), p), whose slope
// diverges at s = 0 and spikes the normal correction into a visible seam.
float aiboidsShapeWave(float s, float k) {
  if (k <= 0.0) return s;
  return tanh(k * s) / tanh(k);
}

// d/ds of aiboidsShapeWave. sech^2(x) = 1 - tanh^2(x).
float aiboidsShapeWaveSlope(float s, float k) {
  if (k <= 0.0) return 1.0;
  float t = tanh(k * s);
  return k * (1.0 - t * t) / tanh(k);
}

// Span-normalised position along the wing. Shared by the displacement and the
// normal correction so the two can never drift apart.
float aiboidsWingT(float x) {
  return clamp((abs(x) - uWingRoot) / uWingSpan, 0.0, 1.0);
}
`;
}

function vertexDisplacementSnippet(): string {
  // Span-normalised coordinate t ∈ [0, 1] along the wing (shoulder→tip).
  // The left-wing vertices sit at X < 0, right-wing at X > 0; abs() handles
  // both identically so a single attribute drives both meshes.
  //
  // t is measured from the panel's OWN root (uWingRoot = the smallest |x| in
  // the geometry), not from the model origin. Bird wings, and every fish fin
  // but one, start at x = 0 exactly, so this is identical to |x| / span for
  // them. The sea horse pectoral is the exception: its root is seated on the
  // body's side surface at |x| ≈ 0.34, and measuring from the origin would
  // hand the root a quarter of the deflection and tear it out of the flank.
  //
  // A smoothstep envelope ensures zero displacement at the shoulder (the
  // pivot stays fixed through the rigid rotation) and ramps smoothly up to
  // the full deflection at the tip.
  //
  // The wave propagates outward: the shoulder rides the raw flap phase while
  // each spanwise slice lags it by uWingUndulationWaveNumber * t radians, so
  // the tip always trails the root.
  return `
  if (uWingSpan > 1e-6) {
    float wingT = aiboidsWingT(position.x);
    float wingEnvelope = wingT * wingT * (3.0 - 2.0 * wingT);
    transformed.z += uWingUndulationAmplitude * wingEnvelope
                     * aiboidsShapeWave(sin(wingUndulationPhase - uWingUndulationWaveNumber * wingT),
                                        uWingSlapSharpness);
  }
`;
}

/**
 * Corrects the normal for the displacement, exactly.
 *
 * The vertex shader moves each vertex by `z += w(x)`, a heightfield in one
 * variable. The Jacobian of `(x, y, z) → (x, y, z + w(x))` is
 *
 * ```
 * [ 1     0  0 ]                                  [ 1  0  -dw/dx ]
 * [ 0     1  0 ]   whose inverse transpose is     [ 0  1   0     ]
 * [ dw/dx 0  1 ]                                  [ 0  0   1     ]
 * ```
 *
 * so the whole correction is one multiply-subtract on `objectNormal.x`. See
 * {@link sampleWingUndulationSlope} for the derivation of `dw/dx` itself.
 *
 * ### Why this is injected separately from the displacement
 * `beginnormal_vertex` is where three.js defines `objectNormal`, and it runs
 * BEFORE `begin_vertex` defines `transformed`. So `wingT` cannot be shared
 * between the two chunks — this recomputes it under its own name. That is why
 * `aiboidsWingT` exists as a function rather than as an inline expression.
 */
function normalSnippet(): string {
  return `
  if (uWingSpan > 1e-6) {
    float nWingRaw = (abs(position.x) - uWingRoot) / uWingSpan;
    // Outboard of the tip and inboard of the root the clamp flattens the
    // displacement, so the surface there is unmoved and its normal must be too.
    if (nWingRaw > 0.0 && nWingRaw < 1.0) {
      float nTheta = wingUndulationPhase - uWingUndulationWaveNumber * nWingRaw;
      float nSin = sin(nTheta);
      float nEnvelope = nWingRaw * nWingRaw * (3.0 - 2.0 * nWingRaw);
      float nEnvelopeSlope = 6.0 * nWingRaw * (1.0 - nWingRaw);
      float nWave = aiboidsShapeWave(nSin, uWingSlapSharpness);
      float nWaveSlope = aiboidsShapeWaveSlope(nSin, uWingSlapSharpness) * cos(nTheta);
      float nDwdt = uWingUndulationAmplitude
        * (nEnvelopeSlope * nWave - uWingUndulationWaveNumber * nEnvelope * nWaveSlope);
      float nDwdx = nDwdt * sign(position.x) / uWingSpan;
      objectNormal.x -= nDwdx * objectNormal.z;
      objectNormal = normalize(objectNormal);
    }
  }
`;
}

// ---- Material patching ----

function patchOneMaterial(
  material: THREE.MeshStandardMaterial,
  root: number,
  span: number,
  config: WingUndulationConfig,
): void {
  const amplitude = span * config.amplitudeFraction;
  const waveNumber = config.tipPhaseLagRad;
  const sharpness = config.slapSharpness ?? UNSHAPED_WAVE;
  // The sentinel is bumped whenever the emitted GLSL changes shape, and every
  // value that reaches the GLSL is in the key. three.js reuses a compiled
  // program for any two materials whose keys match, so a value that changes the
  // source but not the key ships as a stale shader.
  const cacheKey =
    `aiboids-wing-undulation-v3:${root.toFixed(5)}:${span.toFixed(5)}:${amplitude.toFixed(5)}:${waveNumber.toFixed(5)}:${sharpness.toFixed(5)}`;

  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);

  material.customProgramCacheKey = () => {
    const base = previousCacheKey?.() ?? '';
    return base.length ? `${base}|${cacheKey}` : cacheKey;
  };

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);

    Object.assign(shader.uniforms, {
      uWingRoot: { value: root },
      uWingSpan: { value: span },
      uWingUndulationAmplitude: { value: amplitude },
      uWingUndulationWaveNumber: { value: waveNumber },
      uWingSlapSharpness: { value: sharpness },
    });

    shader.vertexShader = vertexDeclarations() + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>\n${normalSnippet()}`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n${vertexDisplacementSnippet()}`,
    );
  };

  material.needsUpdate = true;
}

/**
 * Measures the panel's spanwise extent along X: `root` is the smallest |x| in
 * the geometry (where the panel meets the body) and `span` is the distance
 * from there out to the tip. Read from the positions rather than the bounding
 * box because a bounding box cannot express "the panel starts at |x| = 0.34" —
 * min.x and max.x straddle the origin for a mirrored pair.
 */
export function measureSpanwiseExtent(
  geometry: THREE.BufferGeometry,
): { root: number; span: number } {
  const position = geometry.getAttribute('position');
  if (!position) return { root: 0, span: 1 };
  let root = Infinity;
  let tip = 0;
  for (let i = 0; i < position.count; i++) {
    const ax = Math.abs(position.getX(i));
    if (ax < root) root = ax;
    if (ax > tip) tip = ax;
  }
  if (!Number.isFinite(root)) return { root: 0, span: 1 };
  // Degenerate case: every vertex sits at the same |x|, so the panel has no
  // spanwise extent to measure from its own root. Fall back to measuring from
  // the model origin, which is what a panel like that can still undulate
  // about. Without this the span would be ~0 and the amplitude with it, so the
  // undulation would silently vanish rather than fail loudly.
  const spanFromRoot = tip - root;
  if (spanFromRoot < 1e-6) return { root: 0, span: Math.max(1e-6, tip) };
  return { root, span: spanFromRoot };
}

/**
 * Clones a wing mesh's geometry (so the instanced phase attribute belongs only
 * to this batch, not shared across all batches), attaches the shared phase
 * attribute, patches the material, and derives the span from the bounding box.
 */
function setupOneMesh(
  mesh: THREE.InstancedMesh,
  phaseAttribute: THREE.InstancedBufferAttribute,
  config: WingUndulationConfig,
): void {
  const geometry = mesh.geometry.clone();
  mesh.geometry = geometry;
  const { root, span } = measureSpanwiseExtent(geometry);
  geometry.setAttribute('wingUndulationPhase', phaseAttribute);
  patchOneMaterial(mesh.material as THREE.MeshStandardMaterial, root, span, config);
}

/**
 * Applies the wing-undulation vertex-shader patch to both wing meshes and
 * returns the shared per-instance phase attribute for the renderer to update
 * every frame.
 *
 * ### Trap: clone FIRST, patch AFTER
 * `Renderer3D.buildRenderBatch` has already called `patchWingMaterial` on each
 * material (e.g. dragon-scale shader). Our patch is applied here, AFTER that,
 * and chains correctly: `previousCompile` calls the existing handler first,
 * then this handler adds the undulation on top. Both `onBeforeCompile` and
 * `customProgramCacheKey` are chained, never replaced.
 */
export function applyWingUndulationShader({
  wingLeft,
  wingRight,
  config,
}: {
  wingLeft: THREE.InstancedMesh;
  wingRight: THREE.InstancedMesh;
  config: WingUndulationConfig;
}): WingUndulationInstanceState {
  const instanceCapacity = wingLeft.instanceMatrix.count;
  const phaseAttribute = new THREE.InstancedBufferAttribute(
    new Float32Array(instanceCapacity),
    1,
  );
  phaseAttribute.setUsage(THREE.DynamicDrawUsage);

  setupOneMesh(wingLeft, phaseAttribute, config);
  setupOneMesh(wingRight, phaseAttribute, config);

  return { phaseAttribute };
}
