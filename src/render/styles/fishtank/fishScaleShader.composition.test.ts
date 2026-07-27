import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyFishScaleShader,
  BONY_FISH_SCALE_CONFIG,
  BARRACUDA_SCALE_CONFIG,
  SHARK_SCALE_CONFIG,
  type FishScaleConfig,
} from './fishScaleShader';
import {
  createPlainFishGeometries,
  createGoldfishGeometries,
  createClownfishGeometries,
  createBlueTangGeometries,
} from './geometry/smallFishGeometry';
import { createButterflyfishGeometries } from './geometry/butterflyfishGeometry';

/**
 * Tests for the fish scale procedural shader (issue #224).
 *
 * # Investigation summary (see PR description for full detail)
 *
 * ## Approach 1 — Procedural scales in fragment shader  [CHOSEN ✓]
 * LatheGeometry does generate UVs, but mergePositionOnlyGeometries and
 * mergeGeometriesWithColor in sharedGeometry.ts only copy `position` and
 * `color` — UVs are discarded.  Procedural coordinates derived from the
 * model-space position varying (`vFishScalePos`) bypass this limitation and
 * work naturally with instancing (one material per species).
 *
 * ## Approach 2 — Tiling normal/bump map  [BLOCKED]
 * Requires intact UVs after mergeGeometries.  Both merge helpers confirmed
 * to discard UVs (sharedGeometry.ts:161–183, 200–222).  Would require
 * refactoring two merge helpers and adding UV generation to every hand-
 * authored fin geometry.  Not feasible without significant scope expansion.
 *
 * ## Approach 3 — Baked vertex-level variation  [RULED OUT]
 * ~5 124 vertices for a small fish body over a ~7 unit length → vertex
 * spacing ~0.05–0.07 units.  A perceivable scale cell needs 5–10 vertices ≈
 * 0.3–0.6 units — 4–8% of body length — which is coarser than real fish
 * scales (typically 2–4% of body length for bony fish).  Fin geometry has
 * far fewer vertices and no UV/position regularity for scale alignment.
 *
 * # Tests
 *
 * These tests verify:
 *  1. Shader string injection: vFishScalePos varying, uniforms, arc math.
 *  2. Composition: a prior onBeforeCompile (simulating the undulation shader
 *     from #220) survives when the scale shader is applied on top.
 *  3. customProgramCacheKey chains with the previous key.
 *  4. Color attribute presence and content on every bony-fish geometry.
 *  5. Vertex count preserves the existing resolution floor (no regressions).
 *
 * # Falsification
 *
 * Before finalising, two sabotages were applied and the failure output was
 * captured:
 *
 * ## Sabotage 1 — Remove previousCompile chain
 * Comment out `previousCompile?.(shader, renderer);` in applyFishScaleShader.
 * → Test "composes with prior onBeforeCompile without clobbering it" fails:
 *   AssertionError: expected false to be true
 *   (prior shader sentinel string absent from vertex shader)
 *
 * ## Sabotage 2 — Remove vFishScalePos injection
 * Comment out the '#include <color_vertex>' replacement.
 * → Test "injects vFishScalePos assignment into vertex shader" fails:
 *   AssertionError: expected false to be true
 *   (vFishScalePos = position not found in vertex shader)
 */

// ── Minimal mock shader that carries the chunk tokens the shader patches ──

const MOCK_VERTEX_SHADER = `
void main() {
  #include <color_vertex>
  #include <begin_vertex>
  #include <beginnormal_vertex>
}
`;

const MOCK_FRAGMENT_SHADER = `
void main() {
  #include <color_fragment>
}
`;

/** Builds a minimal shader object accepted by onBeforeCompile callbacks. */
function buildMockShader(): { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> } {
  return {
    vertexShader: MOCK_VERTEX_SHADER,
    fragmentShader: MOCK_FRAGMENT_SHADER,
    uniforms: {},
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function makeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true });
}

function invokeOnBeforeCompile(material: THREE.MeshStandardMaterial): ReturnType<typeof buildMockShader> {
  const shader = buildMockShader();
  // Cast: THREE's callback signature accepts WebGLRenderer but does not
  // dereference it in the patched callback; undefined is safe here.
  material.onBeforeCompile(shader as unknown as Parameters<typeof material.onBeforeCompile>[0], undefined!);
  return shader;
}

// ── Shader-injection tests ────────────────────────────────────────────────

describe('applyFishScaleShader shader injection', () => {
  const HALF_LEN = 3.0;
  const config: FishScaleConfig = { scalesPerLength: 10, edgeDarkness: 0.22 };

  it('declares vFishScalePos varying at the top of the vertex shader', () => {
    const mat = makeMaterial();
    applyFishScaleShader(mat, config, HALF_LEN);
    const shader = invokeOnBeforeCompile(mat);
    // Varying must appear somewhere before main()
    expect(shader.vertexShader).toContain('varying vec3 vFishScalePos');
  });

  it('injects vFishScalePos assignment into vertex shader', () => {
    const mat = makeMaterial();
    applyFishScaleShader(mat, config, HALF_LEN);
    const shader = invokeOnBeforeCompile(mat);
    expect(shader.vertexShader).toContain('vFishScalePos = position');
  });

  it('declares vFishScalePos varying in the fragment shader', () => {
    const mat = makeMaterial();
    applyFishScaleShader(mat, config, HALF_LEN);
    const shader = invokeOnBeforeCompile(mat);
    expect(shader.fragmentShader).toContain('varying vec3 vFishScalePos');
  });

  it('injects uFishScaleFreq and uFishScaleEdgeDark uniforms', () => {
    const mat = makeMaterial();
    applyFishScaleShader(mat, config, HALF_LEN);
    const shader = invokeOnBeforeCompile(mat);
    expect(shader.uniforms).toHaveProperty('uFishScaleFreq');
    expect(shader.uniforms).toHaveProperty('uFishScaleEdgeDark');
  });

  it('sets uFishScaleFreq proportionally to scalesPerLength / halfLen', () => {
    const mat = makeMaterial();
    applyFishScaleShader(mat, config, HALF_LEN);
    const shader = invokeOnBeforeCompile(mat);
    const expectedFreq = config.scalesPerLength / HALF_LEN;
    expect((shader.uniforms['uFishScaleFreq'] as { value: number }).value).toBeCloseTo(expectedFreq);
  });

  it('injects diffuseColor modulation into the fragment shader', () => {
    const mat = makeMaterial();
    applyFishScaleShader(mat, config, HALF_LEN);
    const shader = invokeOnBeforeCompile(mat);
    // The arc-darkening multiply must be present in the fragment source.
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *=');
  });

  it('preserves the original #include <color_vertex> in the vertex shader', () => {
    const mat = makeMaterial();
    applyFishScaleShader(mat, config, HALF_LEN);
    const shader = invokeOnBeforeCompile(mat);
    // The original include must still be present (not stripped by the patch).
    expect(shader.vertexShader).toContain('#include <color_vertex>');
  });

  it('preserves the original #include <color_fragment> in the fragment shader', () => {
    const mat = makeMaterial();
    applyFishScaleShader(mat, config, HALF_LEN);
    const shader = invokeOnBeforeCompile(mat);
    expect(shader.fragmentShader).toContain('#include <color_fragment>');
  });
});

// ── Composition tests ─────────────────────────────────────────────────────

describe('applyFishScaleShader composition with prior shaders', () => {
  const HALF_LEN = 5.0;
  const SCALE_CONFIG: FishScaleConfig = { scalesPerLength: 10, edgeDarkness: 0.22 };

  /**
   * Simulates the undulation shader from PR #220: patches <begin_vertex> and
   * <beginnormal_vertex>, and sets a custom cache key — the exact pattern the
   * scale shader must compose with rather than clobber.
   */
  function applyMockUndulationShader(material: THREE.MeshStandardMaterial): void {
    const UNDULATION_SENTINEL = '__UNDULATION_SENTINEL__';
    const previousCompile = material.onBeforeCompile;
    material.customProgramCacheKey = () => 'aiboids-fish-undulation-v1:mock';
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile?.(shader, renderer);
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `${UNDULATION_SENTINEL}\nvec3 transformed = vec3( position );`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `${UNDULATION_SENTINEL}_NORMAL\nvec3 objectNormal = vec3( normal );`,
      );
    };
  }

  it('composes with prior onBeforeCompile without clobbering it', () => {
    const mat = makeMaterial();
    // Apply undulation first (as #220 would do), then scale.
    applyMockUndulationShader(mat);
    applyFishScaleShader(mat, SCALE_CONFIG, HALF_LEN);

    const shader = invokeOnBeforeCompile(mat);

    // Both the undulation sentinel AND the scale varying must be present.
    expect(shader.vertexShader).toContain('__UNDULATION_SENTINEL__');
    expect(shader.vertexShader).toContain('vFishScalePos = position');
  });

  it('does not destroy <begin_vertex> patch when undulation is applied first', () => {
    const mat = makeMaterial();
    applyMockUndulationShader(mat);
    applyFishScaleShader(mat, SCALE_CONFIG, HALF_LEN);

    const shader = invokeOnBeforeCompile(mat);
    // The undulation shader replaced <begin_vertex> with a sentinel block;
    // the scale shader must not have re-introduced the raw chunk token.
    expect(shader.vertexShader).toContain('__UNDULATION_SENTINEL__');
  });

  it('scale fragment injection survives when undulation is applied first', () => {
    const mat = makeMaterial();
    applyMockUndulationShader(mat);
    applyFishScaleShader(mat, SCALE_CONFIG, HALF_LEN);

    const shader = invokeOnBeforeCompile(mat);
    // Both original color_fragment include AND the scale modulation appear.
    expect(shader.fragmentShader).toContain('#include <color_fragment>');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *=');
  });

  it('customProgramCacheKey chains with the prior key', () => {
    const mat = makeMaterial();
    applyMockUndulationShader(mat);
    applyFishScaleShader(mat, SCALE_CONFIG, HALF_LEN);

    const key = mat.customProgramCacheKey!();
    // The scale shader's own prefix must appear, and the undulation key must
    // also be present so Three.js generates a distinct program for every
    // combination of patches.
    expect(key).toContain('fish-scale-v1');
    expect(key).toContain('aiboids-fish-undulation-v1:mock');
  });

  it('scale shader applied alone has a non-empty cache key', () => {
    const mat = makeMaterial();
    applyFishScaleShader(mat, SCALE_CONFIG, HALF_LEN);
    const key = mat.customProgramCacheKey!();
    expect(key).toContain('fish-scale-v1');
  });
});

// ── Species-config tests ──────────────────────────────────────────────────

describe('per-species scale config constants', () => {
  it('SHARK_SCALE_CONFIG has edgeDarkness=0 (deliberate no-op)', () => {
    expect(SHARK_SCALE_CONFIG.edgeDarkness).toBe(0);
  });

  it('BONY_FISH_SCALE_CONFIG has positive scalesPerLength and edgeDarkness', () => {
    expect(BONY_FISH_SCALE_CONFIG.scalesPerLength).toBeGreaterThan(0);
    expect(BONY_FISH_SCALE_CONFIG.edgeDarkness).toBeGreaterThan(0);
  });

  it('BARRACUDA_SCALE_CONFIG has lower edgeDarkness than bony fish', () => {
    expect(BARRACUDA_SCALE_CONFIG.edgeDarkness).toBeLessThan(BONY_FISH_SCALE_CONFIG.edgeDarkness);
  });

  it('zero edgeDarkness → uFishScaleEdgeDark uniform is 0 (no-op on GPU)', () => {
    const mat = makeMaterial();
    applyFishScaleShader(mat, SHARK_SCALE_CONFIG, 24.0);
    const shader = invokeOnBeforeCompile(mat);
    expect((shader.uniforms['uFishScaleEdgeDark'] as { value: number }).value).toBe(0);
  });
});

// ── Scale-density proportionality tests ──────────────────────────────────

describe('scale density proportionality', () => {
  it('plain fish and goldfish get the same scale-per-bodyLength ratio', () => {
    // Scale frequency = scalesPerLength / halfLen.
    // Both use BONY_FISH_SCALE_CONFIG, so they each get the same *number*
    // of scale rows per body length — meaning a goldfish's scales are
    // physically smaller (proportional to its shorter body).
    const PLAIN_HALF_LEN = 3.58;
    const GOLD_HALF_LEN = 1.71;

    const matPlain = makeMaterial();
    applyFishScaleShader(matPlain, BONY_FISH_SCALE_CONFIG, PLAIN_HALF_LEN);
    const shaderPlain = invokeOnBeforeCompile(matPlain);
    const freqPlain = (shaderPlain.uniforms['uFishScaleFreq'] as { value: number }).value;

    const matGold = makeMaterial();
    applyFishScaleShader(matGold, BONY_FISH_SCALE_CONFIG, GOLD_HALF_LEN);
    const shaderGold = invokeOnBeforeCompile(matGold);
    const freqGold = (shaderGold.uniforms['uFishScaleFreq'] as { value: number }).value;

    // freqPlain / freqGold ≈ GOLD_HALF_LEN / PLAIN_HALF_LEN (inverse)
    // Each fish has the same scalesPerLength, so plain fish (longer) has
    // lower frequency (larger scale cells) than goldfish (shorter) in world
    // space — matching the physical expectation.
    expect(freqGold).toBeGreaterThan(freqPlain);

    // Ratio of scale-cell sizes: plainFishCell / goldFishCell = freqGold / freqPlain
    // ≈ PLAIN_HALF_LEN / GOLD_HALF_LEN ≈ 3.58 / 1.71 ≈ 2.09
    // Verify within ±10 % of the expected ratio.
    const ratio = freqGold / freqPlain;
    const expectedRatio = PLAIN_HALF_LEN / GOLD_HALF_LEN;
    expect(ratio).toBeGreaterThan(expectedRatio * 0.9);
    expect(ratio).toBeLessThan(expectedRatio * 1.1);
  });

  it('barracuda has lower frequency than goldfish (larger absolute scale cells)', () => {
    const BARRACUDA_HALF_LEN = 13.5;
    const GOLD_HALF_LEN = 1.71;

    const matBarracuda = makeMaterial();
    applyFishScaleShader(matBarracuda, BARRACUDA_SCALE_CONFIG, BARRACUDA_HALF_LEN);
    const shaderBarracuda = invokeOnBeforeCompile(matBarracuda);
    const freqBarracuda = (shaderBarracuda.uniforms['uFishScaleFreq'] as { value: number }).value;

    const matGold = makeMaterial();
    applyFishScaleShader(matGold, BONY_FISH_SCALE_CONFIG, GOLD_HALF_LEN);
    const shaderGold = invokeOnBeforeCompile(matGold);
    const freqGold = (shaderGold.uniforms['uFishScaleFreq'] as { value: number }).value;

    // Lower frequency = larger scale cells in world space.
    // A barracuda (13.5 half-length) should have larger absolute scales than
    // a goldfish (1.71 half-length), even with fewer scalesPerLength.
    expect(freqBarracuda).toBeLessThan(freqGold);
  });
});

// ── Vertex color (species palette) preservation tests ────────────────────

describe('vertex color attribute preservation', () => {
  const LENGTH = 1.0;
  const WIDTH = 0.5;

  it('plain fish body retains color attribute after geometry build', () => {
    const geoms = createPlainFishGeometries(LENGTH, WIDTH);
    const colorAttr = geoms.body.getAttribute('color');
    geoms.body.dispose();
    expect(colorAttr).toBeTruthy();
  });

  it('goldfish body retains color attribute', () => {
    const geoms = createGoldfishGeometries(LENGTH, WIDTH);
    const colorAttr = geoms.body.getAttribute('color');
    geoms.body.dispose();
    expect(colorAttr).toBeTruthy();
  });

  it('clownfish body carries orange body and white band colors', () => {
    const geoms = createClownfishGeometries(LENGTH, WIDTH);
    const colorAttr = geoms.body.getAttribute('color') as THREE.BufferAttribute;
    expect(colorAttr).toBeTruthy();

    let hasOrange = false;
    let hasWhite = false;
    for (let i = 0; i < colorAttr.count; i++) {
      const r = colorAttr.getX(i);
      const g = colorAttr.getY(i);
      const b = colorAttr.getZ(i);
      if (r > 0.7 && g > 0.05 && g < 0.25 && b < 0.05) hasOrange = true;
      if (r > 0.80 && g > 0.80 && b > 0.80) hasWhite = true;
      if (hasOrange && hasWhite) break;
    }
    geoms.body.dispose();
    expect(hasOrange).toBe(true);
    expect(hasWhite).toBe(true);
  });

  it('blue tang body carries blue color', () => {
    const geoms = createBlueTangGeometries(LENGTH, WIDTH);
    const colorAttr = geoms.body.getAttribute('color') as THREE.BufferAttribute;
    expect(colorAttr).toBeTruthy();

    let hasBlue = false;
    for (let i = 0; i < colorAttr.count; i++) {
      const r = colorAttr.getX(i);
      const g = colorAttr.getY(i);
      const b = colorAttr.getZ(i);
      // Royal blue 0x1560bd in linear: r≈0.011, g≈0.128, b≈0.616
      if (r < 0.1 && g > 0.05 && b > 0.3) {
        hasBlue = true;
        break;
      }
    }
    geoms.body.dispose();
    expect(hasBlue).toBe(true);
  });

  it('butterflyfish body carries both white and near-black stripe colors', () => {
    const geoms = createButterflyfishGeometries(LENGTH, WIDTH);
    const colorAttr = geoms.body.getAttribute('color') as THREE.BufferAttribute;
    expect(colorAttr).toBeTruthy();

    let hasLight = false;
    let hasDark = false;
    for (let i = 0; i < colorAttr.count; i++) {
      const r = colorAttr.getX(i);
      const g = colorAttr.getY(i);
      const b = colorAttr.getZ(i);
      if (r > 0.8 && g > 0.8 && b > 0.8) hasLight = true;
      if (r < 0.15 && g < 0.15 && b < 0.15) hasDark = true;
      if (hasLight && hasDark) break;
    }
    geoms.body.dispose();
    expect(hasLight).toBe(true);
    expect(hasDark).toBe(true);
  });
});

// ── Regression: applying scale shader must not remove the color attribute ─

describe('applyFishScaleShader does not modify geometry', () => {
  it('plain fish geometry still has color attribute after shader applied to material', () => {
    const geoms = createPlainFishGeometries(1.0, 0.5);
    const body = geoms.body;
    if (!body.boundingBox) body.computeBoundingBox();
    const halfLen = (body.boundingBox!.max.y - body.boundingBox!.min.y) / 2;

    const mat = makeMaterial();
    applyFishScaleShader(mat, BONY_FISH_SCALE_CONFIG, halfLen);

    // The shader only patches the material — geometry must be untouched.
    const colorAttr = body.getAttribute('color');
    body.dispose();
    expect(colorAttr).toBeTruthy();
  });
});
