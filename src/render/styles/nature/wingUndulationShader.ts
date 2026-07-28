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
 * Normal vectors are NOT recomputed after the displacement. The deflection at
 * the tip is typically 5–10 % of chord, which introduces a lighting error of
 * roughly the same fraction; at the fast flap rates in use this is imperceptible.
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
}

/** Returned by applyWingUndulationShader; held in BoidRenderBatch and updated
 * every frame by CreatureInstanceRenderer so the GPU sees current per-instance
 * flap phases. */
export interface WingUndulationInstanceState {
  /** Per-instance flap phase (radians). Written by the renderer each frame
   * and read by the vertex shader. Both wing meshes share the same buffer. */
  phaseAttribute: THREE.InstancedBufferAttribute;
}

// ---- GLSL helpers injected into the vertex shader ----

function vertexDeclarations(): string {
  return `
attribute float wingUndulationPhase;
uniform float uWingSpan;
uniform float uWingUndulationAmplitude;
uniform float uWingUndulationWaveNumber;
`;
}

function vertexDisplacementSnippet(): string {
  // Span-normalised coordinate t ∈ [0, 1] along the wing (shoulder→tip).
  // The left-wing vertices sit at X < 0, right-wing at X > 0; abs() handles
  // both identically so a single attribute drives both meshes.
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
    float wingT = clamp(abs(position.x) / uWingSpan, 0.0, 1.0);
    float wingEnvelope = wingT * wingT * (3.0 - 2.0 * wingT);
    transformed.z += uWingUndulationAmplitude * wingEnvelope
                     * sin(wingUndulationPhase - uWingUndulationWaveNumber * wingT);
  }
`;
}

// ---- Material patching ----

function patchOneMaterial(
  material: THREE.MeshStandardMaterial,
  span: number,
  config: WingUndulationConfig,
): void {
  const amplitude = span * config.amplitudeFraction;
  const waveNumber = config.tipPhaseLagRad;
  const cacheKey =
    `aiboids-wing-undulation-v1:${span.toFixed(5)}:${amplitude.toFixed(5)}:${waveNumber.toFixed(5)}`;

  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);

  material.customProgramCacheKey = () => {
    const base = previousCacheKey?.() ?? '';
    return base.length ? `${base}|${cacheKey}` : cacheKey;
  };

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);

    Object.assign(shader.uniforms, {
      uWingSpan: { value: span },
      uWingUndulationAmplitude: { value: amplitude },
      uWingUndulationWaveNumber: { value: waveNumber },
    });

    shader.vertexShader = vertexDeclarations() + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n${vertexDisplacementSnippet()}`,
    );
  };

  material.needsUpdate = true;
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
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const span = geometry.boundingBox
    ? Math.max(
        Math.abs(geometry.boundingBox.min.x),
        Math.abs(geometry.boundingBox.max.x),
      )
    : 1;
  geometry.setAttribute('wingUndulationPhase', phaseAttribute);
  patchOneMaterial(mesh.material as THREE.MeshStandardMaterial, span, config);
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
