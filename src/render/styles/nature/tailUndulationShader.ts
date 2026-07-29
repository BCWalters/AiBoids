import * as THREE from 'three';
import { patchMaterial } from '../../patchMaterial';

/**
 * Vertex-shader undulation for streaming / whipping tails (issue #251).
 *
 * Originally written for the unicorn's rainbow tail, this is creature-agnostic:
 * it needs only a tail mesh whose geometry sweeps along −Y from root to tip,
 * which is the convention every nature-scene tail is built to. The unicorn,
 * the dragon and every bird use it with different configs.
 *
 * The tail is welded to the body by the unconditional tail-weld in
 * CreatureInstanceRenderer (see line ~722) — that is intentional and is NOT
 * changed here. Instead, a wave is injected at the vertex level so the tail
 * appears to stream and flex while the rig matrix itself stays the body transform.
 *
 * This composes with, rather than replaces, a rigid `tailRig` sway: the rig
 * rotates the whole tail about its root via the instance matrix, while this
 * shader displaces vertices in model space beforehand. The dragon and the birds
 * use both — a slow rigid sweep carrying a faster flex along the tail's length.
 *
 * Axis conventions (critical — see problem statement):
 *   MODEL_UP  = +Z   ← "upwards" for issue #251
 *   FORWARD   = +Y
 *   MODEL_RIGHT = +X
 *
 * The tail geometry sweeps mostly in the −Y direction from the rump (most
 * positive Y end) to the tip (most negative Y end). Progress along the tail
 * is derived from the Y coordinate: 0 at root (max Y in bounding box),
 * 1 at tip (min Y).
 *
 * Displacement is in +Z (model up):
 *   dz = upBias * speedFraction * envelope(t)
 *      + amplitude * envelope(t) * sin(phase − waveNumber * t)
 *
 *  - `upBias` gives a steady upward streaming proportional to horizontal speed,
 *    so faster flight lifts the tail higher — the "primarily upwards" part.
 *  - The sine term adds the oscillating undulation layered on top.
 *  - Both terms are gated by a smoothstep envelope so the root (welded to the
 *    rump) never moves and the deflection ramps up smoothly toward the tip.
 *
 * Normal vectors are not recomputed after displacement; the per-vertex normal
 * error is comparable to the displacement fraction, which is small enough
 * (~10 % of tail span) to be invisible at the flap/undulation rates used.
 */
export interface TailUndulationConfig {
  /**
   * Steady upward deflection at the tip when flying at full horizontal speed,
   * expressed as a fraction of the tail's Y span.
   */
  upBiasFraction: number;
  /** Side-to-side oscillation amplitude at the tip, as a fraction of Y span. */
  amplitudeFraction: number;
  /** Vertical oscillation amplitude at the tip, as a fraction of Y span. */
  verticalAmplitudeFraction: number;
  /** Phase lag from root to tip in radians (traveling-wave). */
  tipPhaseLagRad: number;
  /** Angular frequency of the tail's own undulation clock (rad/s). */
  omega: number;
}

/** Held in BoidRenderBatch; updated every frame by CreatureInstanceRenderer. */
export interface TailUndulationInstanceState {
  /** Per-instance accumulated phase for the undulation wave. */
  phaseAttribute: THREE.InstancedBufferAttribute;
  /** Per-instance horizontal speed fraction ∈ [0, 1]. */
  speedFractionAttribute: THREE.InstancedBufferAttribute;
  /** Angular frequency to advance the phase by each frame. */
  omega: number;
}

// ---- GLSL helpers ----

function vertexDeclarations(): string {
  return `
attribute float tailUndulationPhase;
attribute float tailUndulationSpeedFraction;
uniform float uTailRootY;
uniform float uTailTipY;
uniform float uTailUpBias;
uniform float uTailAmplitude;
uniform float uTailVerticalAmplitude;
uniform float uTailWaveNumber;
`;
}

function vertexDisplacementSnippet(): string {
  return `
  {
    float tailSpan = uTailRootY - uTailTipY;
    if (tailSpan > 1e-6) {
      float tailProgress = clamp((uTailRootY - position.y) / tailSpan, 0.0, 1.0);
      float tailEnvelope = tailProgress * tailProgress * (3.0 - 2.0 * tailProgress);
      // Speed-based lift stays vertical (Z = model-up): faster flight streams
      // the tail higher, matching the upward flight pose.
      transformed.z += uTailUpBias * tailUndulationSpeedFraction * tailEnvelope;
      float tailWave = sin(tailUndulationPhase - uTailWaveNumber * tailProgress);
      // Side-to-side swish (X = model-right).
      transformed.x += uTailAmplitude * tailEnvelope * tailWave;
      // Added vertical oscillation on top of the steady speed-lift, for a
      // more dramatic up/down tail motion while still staying flowy.
      transformed.z += uTailVerticalAmplitude * tailEnvelope * tailWave;
    }
  }
`;
}

function patchTailMaterial(
  material: THREE.MeshStandardMaterial,
  rootY: number,
  tipY: number,
  config: TailUndulationConfig,
): void {
  const tailSpan = rootY - tipY;
  const upBias = tailSpan * config.upBiasFraction;
  const amplitude = tailSpan * config.amplitudeFraction;
  const verticalAmplitude = tailSpan * config.verticalAmplitudeFraction;
  const waveNumber = config.tipPhaseLagRad;

  const cacheKey =
    `aiboids-tail-undulation-v4:${rootY.toFixed(4)}:${tipY.toFixed(4)}:` +
    `${upBias.toFixed(4)}:${amplitude.toFixed(4)}:${verticalAmplitude.toFixed(4)}:${waveNumber.toFixed(4)}`;

  patchMaterial({
    material,
    cacheKey,
    patch: (shader) => {

      Object.assign(shader.uniforms, {
        uTailRootY: { value: rootY },
        uTailTipY: { value: tipY },
        uTailUpBias: { value: upBias },
        uTailAmplitude: { value: amplitude },
        uTailVerticalAmplitude: { value: verticalAmplitude },
        uTailWaveNumber: { value: waveNumber },
      });

      shader.vertexShader = vertexDeclarations() + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${vertexDisplacementSnippet()}`,
      );
    },
  });
}

/**
 * Applies the tail-undulation vertex-shader patch and returns the per-instance
 * state buffers for CreatureInstanceRenderer to update every frame.
 *
 * Patching is applied AFTER the scene's `patchTailMaterial` hook has run, so
 * the chain is:
 *   previously-applied patches → this tail-undulation patch
 *
 * That ordering matters for the dragon, whose tail carries the scale shader.
 * The scale pattern is looked up from `position` while this displaces
 * `transformed`, so the scales stay glued to the surface as it flexes.
 *
 * Clone-first semantics: the tail geometry is cloned so its instanced
 * attributes belong to this batch alone.
 */
export function applyTailUndulationShader({
  tailMesh,
  config,
}: {
  tailMesh: THREE.InstancedMesh;
  config: TailUndulationConfig;
}): TailUndulationInstanceState {
  // Clone geometry so the instanced attributes belong to this batch.
  const geometry = tailMesh.geometry.clone();
  tailMesh.geometry = geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();

  const rootY = geometry.boundingBox?.max.y ?? 0;
  const tipY = geometry.boundingBox?.min.y ?? -1;

  const instanceCapacity = tailMesh.instanceMatrix.count;

  const phaseAttribute = new THREE.InstancedBufferAttribute(
    new Float32Array(instanceCapacity),
    1,
  );
  phaseAttribute.setUsage(THREE.DynamicDrawUsage);

  const speedFractionAttribute = new THREE.InstancedBufferAttribute(
    new Float32Array(instanceCapacity),
    1,
  );
  speedFractionAttribute.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute('tailUndulationPhase', phaseAttribute);
  geometry.setAttribute('tailUndulationSpeedFraction', speedFractionAttribute);

  patchTailMaterial(
    tailMesh.material as THREE.MeshStandardMaterial,
    rootY,
    tipY,
    config,
  );

  return {
    phaseAttribute,
    speedFractionAttribute,
    omega: config.omega,
  };
}
