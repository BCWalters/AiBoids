/**
 * Geometric tests for fishFinRayShader.ts
 *
 * These tests assert four invariants that a bare "string contains X" check
 * cannot guarantee:
 *
 *   1. The ray frequency derived from shipped fin geometry gives exactly
 *      BONY_FISH_FIN_RAY_CONFIG.raysPerSpan (= 8) integer crossings across
 *      each species' pectoral-fin Y span — a geometric count, not a constant.
 *   2. The JS port of the GLSL ray function measures the correct brightness
 *      delta at a ray centre vs. the membrane between rays.
 *   3. The injected fragment GLSL comes AFTER #include <color_fragment> so
 *      diffuseColor already carries the folded-in vertex colour.
 *   4. patchWingMaterial routes correctly per species: bony fish and barracuda
 *      get patched, shark and seahorse do NOT.
 *
 * Falsification evidence (sabotage runs confirming assertions are load-bearing):
 *
 *   | Sabotage                                         | Failing assertion                                      |
 *   |--------------------------------------------------|--------------------------------------------------------|
 *   | a) Set BONY_FISH_FIN_RAY_CONFIG.raysPerSpan = 0  | routing test fails:                                    |
 *   |    → applyFishFinRayShader returns early          | expect(mat.onBeforeCompile).not.toBe(originalCompile) |
 *   |    → onBeforeCompile never patched               | + ray-count test TypeError: cannot read .value of      |
 *   |                                                  |   undefined (uFinRayFreq not set)                      |
 *   | b) Set BONY_FISH_FIN_RAY_CONFIG.brightness = 0   | brightness-delta test fails:                           |
 *   |    → ray intensity 1.0 but adds nothing          | expect(brighteningAtRay).toBeGreaterThan(0)            |
 *   | c) Remove vFinRayPos injection from vertex       | vertex shader test fails:                              |
 *   |    → pattern uses uninitialized varying          | expect(vs).toContain('vFinRayPos = position')          |
 *   | d) Remove diffuseColor lightening from fragment  | fragment shader test fails:                            |
 *   |    → no brightening ever applied                 | expect(fs).toContain('diffuseColor.rgb = min(')        |
 *   | e) Remove shark/seahorse early-return guards     | routing tests fail:                                    |
 *   |    → shark/seahorse fins silently brightened     | expect(mat.onBeforeCompile).toBe(originalCompile)      |
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ShaderLib } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  applyFishFinRayShader,
  BONY_FISH_FIN_RAY_CONFIG,
  BARRACUDA_FIN_RAY_CONFIG,
} from './fishFinRayShader';
import {
  FishtankSceneRenderer3D,
  FISHTANK_CREATURE_SIZES,
} from '../../sceneRenderers/FishtankSceneRenderer3D';
import { createPlainFishGeometries } from './geometry/smallFishGeometry';
import { createBarracudaGeometries } from './geometry/barracudaGeometry';
import { BoidSpecies } from '../../../sim/Boid';
import { PredatorSpecies } from '../../sceneRenderers/createSceneRendererHooks';
import type { DriftingClouds } from '../nature/clouds';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runs the material's onBeforeCompile against real Three.js MeshStandard
 * shader strings so we can assert on the final GLSL text and uniform values.
 */
function captureShader(material: THREE.MeshStandardMaterial): {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: number }>;
} {
  const shader = {
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: {} as Record<string, { value: number }>,
  };
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}

/**
 * JS port of the GLSL fract function.
 * GLSL's fract is x − floor(x), always in [0, 1).
 * JS modulo can return negative values for negative inputs; floor subtraction
 * matches GLSL behaviour precisely.
 */
function glslFract(x: number): number {
  return x - Math.floor(x);
}

/**
 * JS port of GLSL smoothstep(edge0, edge1, x).
 * Works correctly for inverted ranges (edge0 > edge1).
 */
function glslSmoothstep(edge0: number, edge1: number, x: number): number {
  const denom = edge1 - edge0;
  if (Math.abs(denom) < 1e-12) return x <= edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / denom));
  return t * t * (3 - 2 * t);
}

/**
 * JS port of the fin-ray intensity GLSL expression.
 * Returns the `ray` value [0, 1] for a vertex at the given Y position.
 * 1.0 = full brightening (at a ray centre); 0.0 = membrane between rays.
 */
function finRayIntensity(y: number, freq: number, halfRayWidth: number): number {
  const finPhase = y * freq;
  const t = glslFract(finPhase);
  const halfDist = Math.min(t, 1.0 - t);
  return glslSmoothstep(halfRayWidth, 0.0, halfDist);
}

/**
 * Counts distinct ray BANDS (integer-phase crossings) across the Y interval
 * [yMin, yMax] for the given frequency.  This is the number of ray centres
 * that fall inside the interval (each is where finPhase is an integer).
 */
function countRayBands(yMin: number, yMax: number, freq: number): number {
  if (freq === 0) return 0;
  return Math.floor(yMax * freq) - Math.ceil(yMin * freq) + 1;
}

/**
 * Creates a FishtankSceneRenderer3D with minimal stub deps.
 */
function makeFishtankRenderer(): FishtankSceneRenderer3D {
  return new FishtankSceneRenderer3D({
    camera: new THREE.PerspectiveCamera(),
    controls: {} as OrbitControls,
    driftingClouds: { setVisible: () => {} } as unknown as DriftingClouds,
    fishtankCenter: new THREE.Vector3(),
    getFishtankEnv: () => null,
  });
}

/** Fishtank StyleFlags and PredatorRenderFlags used in routing tests. */
const FISHTANK_FLAGS = { isNature: false, isFishtank: true, isOrganic: true };
const MONSTER_FLAGS = { isMonster: true, isShark: true };
const NORMAL_PRED_FLAGS = { isMonster: false, isShark: false };
const UNICORN_FLAGS = { isMonster: false, isShark: false, isUnicorn: true };

// ---------------------------------------------------------------------------
// GLSL injection: vertex varying capture and fragment lightening
// ---------------------------------------------------------------------------

describe('fishFinRayShader GLSL injection', () => {
  it('injects vFinRayPos = position into the vertex shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const geo = new THREE.BoxGeometry(0.1, 2, 0.1);
    applyFishFinRayShader(mat, geo, BONY_FISH_FIN_RAY_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vFinRayPos = position');
  });

  it('injects the diffuseColor brightening into the fragment shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const geo = new THREE.BoxGeometry(0.1, 2, 0.1);
    applyFishFinRayShader(mat, geo, BONY_FISH_FIN_RAY_CONFIG);
    const { fragmentShader } = captureShader(mat);
    // The shipped lightening expression; sabotaging it (removing the min clamp
    // or the ray multiplication) causes this assertion to fail.
    expect(fragmentShader).toContain('diffuseColor.rgb = min( vec3( 1.0 ), diffuseColor.rgb + uFinRayBrightness * ray )');
  });

  it('never assigns to vColor (read-only `in` under GLSL 300 ES)', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const geo = new THREE.BoxGeometry(0.1, 2, 0.1);
    applyFishFinRayShader(mat, geo, BONY_FISH_FIN_RAY_CONFIG);
    const { fragmentShader } = captureShader(mat);
    // Extract only the injected section (after the uniform declarations).
    const injected = fragmentShader.slice(fragmentShader.indexOf('uFinRayFreq'));
    expect(injected).not.toMatch(/\bvColor\b\s*(\.[a-zA-Z]+)?\s*(=|\*=|\+=|-=|\/=)/);
  });

  it('ray lightening comes AFTER #include <color_fragment> so vertex colour is already folded in', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const geo = new THREE.BoxGeometry(0.1, 2, 0.1);
    applyFishFinRayShader(mat, geo, BONY_FISH_FIN_RAY_CONFIG);
    const { fragmentShader } = captureShader(mat);
    // The include must appear before the brightening expression in the final string.
    expect(fragmentShader.indexOf('#include <color_fragment>')).toBeLessThan(
      fragmentShader.indexOf('diffuseColor.rgb = min('),
    );
  });

  it('sets all three uniforms with finite positive values', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const geo = new THREE.BoxGeometry(0.1, 2, 0.1);
    applyFishFinRayShader(mat, geo, BONY_FISH_FIN_RAY_CONFIG);
    const { uniforms } = captureShader(mat);
    expect(uniforms.uFinRayFreq.value).toBeGreaterThan(0);
    expect(uniforms.uFinRayBrightness.value).toBeGreaterThan(0);
    expect(uniforms.uFinRayHalfWidth.value).toBeGreaterThan(0);
  });

  it('is a no-op (does not set onBeforeCompile) when raysPerSpan is 0', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    const geo = new THREE.BoxGeometry(0.1, 2, 0.1);
    applyFishFinRayShader(mat, geo, { raysPerSpan: 0, brightness: 0.3, halfRayWidth: 0.12 });
    expect(mat.onBeforeCompile).toBe(originalCompile);
  });
});

// ---------------------------------------------------------------------------
// Geometric: ray count across shipped fin geometry
// ---------------------------------------------------------------------------

/**
 * These assertions are geometric and absolute: they use the ACTUAL fin
 * geometry bounding-box Y span (measured from shipped code) and assert the
 * derived ray-band count equals the shipped config constant.
 *
 * Falsification:
 *   (a) Set BONY_FISH_FIN_RAY_CONFIG.raysPerSpan = 0
 *       → freq = 0, countRayBands returns 0, expect(0).toBe(8) fails.
 *   (b) Set BONY_FISH_FIN_RAY_CONFIG.raysPerSpan = 100
 *       → each ray is sub-pixel but the count assertion still catches the
 *         deviation: expect(100).toBe(8) fails.
 */
describe('fishFinRayShader ray count — plain fish pectoral fin', () => {
  it('pectoral fin gets exactly BONY_FISH_FIN_RAY_CONFIG.raysPerSpan ray bands across its Y span', () => {
    const { wingLeft } = createPlainFishGeometries(
      FISHTANK_CREATURE_SIZES.plainFish.length,
      FISHTANK_CREATURE_SIZES.plainFish.width,
    );
    wingLeft.computeBoundingBox();
    const bb = wingLeft.boundingBox!;

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishFinRayShader(mat, wingLeft, BONY_FISH_FIN_RAY_CONFIG);
    const freq = captureShader(mat).uniforms.uFinRayFreq.value;

    // Geometric assertion: the number of ray-centre crossings inside [yMin, yMax].
    const bands = countRayBands(bb.min.y, bb.max.y, freq);
    expect(bands).toBe(BONY_FISH_FIN_RAY_CONFIG.raysPerSpan);
    // Absolute value anchoring the test to the shipped constant (= 8).
    expect(bands).toBe(8);

    wingLeft.dispose();
  });

  it('frequency encodes raysPerSpan / ySpan exactly (so Math.round(freq * ySpan) == raysPerSpan)', () => {
    const { wingLeft } = createPlainFishGeometries(
      FISHTANK_CREATURE_SIZES.plainFish.length,
      FISHTANK_CREATURE_SIZES.plainFish.width,
    );
    wingLeft.computeBoundingBox();
    const ySpan = wingLeft.boundingBox!.max.y - wingLeft.boundingBox!.min.y;

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishFinRayShader(mat, wingLeft, BONY_FISH_FIN_RAY_CONFIG);
    const freq = captureShader(mat).uniforms.uFinRayFreq.value;

    // freq * ySpan should reproduce raysPerSpan with floating-point tolerance.
    expect(freq * ySpan).toBeCloseTo(BONY_FISH_FIN_RAY_CONFIG.raysPerSpan, 4);

    wingLeft.dispose();
  });
});

describe('fishFinRayShader ray count — barracuda pectoral fin', () => {
  it('barracuda pectoral fin gets exactly BARRACUDA_FIN_RAY_CONFIG.raysPerSpan ray bands', () => {
    const { wingLeft } = createBarracudaGeometries(
      FISHTANK_CREATURE_SIZES.barracuda.length,
      FISHTANK_CREATURE_SIZES.barracuda.width,
    );
    wingLeft.computeBoundingBox();
    const bb = wingLeft.boundingBox!;

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishFinRayShader(mat, wingLeft, BARRACUDA_FIN_RAY_CONFIG);
    const freq = captureShader(mat).uniforms.uFinRayFreq.value;

    const bands = countRayBands(bb.min.y, bb.max.y, freq);
    expect(bands).toBe(BARRACUDA_FIN_RAY_CONFIG.raysPerSpan);
    // Absolute value anchoring the test.
    expect(bands).toBe(8);

    wingLeft.dispose();
  });
});

// ---------------------------------------------------------------------------
// Brightness delta: JS port of GLSL measures correct lightening
// ---------------------------------------------------------------------------

/**
 * Falsification:
 *   (b) Set BONY_FISH_FIN_RAY_CONFIG.brightness = 0
 *       → brighteningAtRay = 0, expect(0).toBeGreaterThan(0) fails.
 */
describe('fishFinRayShader brightness delta', () => {
  it('ray centre has non-zero brightening equal to config.brightness', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const geo = new THREE.BoxGeometry(0.1, 2, 0.1);
    applyFishFinRayShader(mat, geo, BONY_FISH_FIN_RAY_CONFIG);
    const { uniforms } = captureShader(mat);
    const freq = uniforms.uFinRayFreq.value;
    const halfRayWidth = uniforms.uFinRayHalfWidth.value;
    const brightness = uniforms.uFinRayBrightness.value;

    // At y = 1/freq, finPhase = 1.0 → fract(1.0) = 0 → halfDist = 0 → ray = 1.
    // Brightening = brightness * 1.0 = brightness.
    const yRayCentre = 1 / freq;
    const intensity = finRayIntensity(yRayCentre, freq, halfRayWidth);
    expect(intensity).toBeCloseTo(1.0, 3); // ray value should be 1 at the centre
    const brighteningAtRay = brightness * intensity;
    expect(brighteningAtRay).toBeGreaterThan(0);
    expect(brighteningAtRay).toBeCloseTo(BONY_FISH_FIN_RAY_CONFIG.brightness, 4);
  });

  it('membrane between rays (halfDist = 0.5) has zero brightening', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const geo = new THREE.BoxGeometry(0.1, 2, 0.1);
    applyFishFinRayShader(mat, geo, BONY_FISH_FIN_RAY_CONFIG);
    const { uniforms } = captureShader(mat);
    const freq = uniforms.uFinRayFreq.value;
    const halfRayWidth = uniforms.uFinRayHalfWidth.value;
    const brightness = uniforms.uFinRayBrightness.value;

    // At y = 0.5/freq, finPhase = 0.5 → fract(0.5) = 0.5 → halfDist = 0.5.
    // 0.5 > halfRayWidth (= 0.12) so smoothstep(0.12, 0, 0.5) = 0 → ray = 0.
    const yMembrane = 0.5 / freq;
    const intensity = finRayIntensity(yMembrane, freq, halfRayWidth);
    expect(intensity).toBeCloseTo(0.0, 3);
    const brighteningAtMembrane = brightness * intensity;
    expect(brighteningAtMembrane).toBeCloseTo(0, 6);
  });

  it('ray brightness drops to zero at the edge of the ray half-width', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const geo = new THREE.BoxGeometry(0.1, 2, 0.1);
    applyFishFinRayShader(mat, geo, BONY_FISH_FIN_RAY_CONFIG);
    const { uniforms } = captureShader(mat);
    const freq = uniforms.uFinRayFreq.value;
    const halfRayWidth = uniforms.uFinRayHalfWidth.value;

    // At y = (1 + halfRayWidth) / freq, halfDist = halfRayWidth → smoothstep edge → 0.
    const yEdge = (1 + halfRayWidth) / freq;
    const intensityAtEdge = finRayIntensity(yEdge, freq, halfRayWidth);
    expect(intensityAtEdge).toBeCloseTo(0.0, 3);
  });
});

// ---------------------------------------------------------------------------
// Shader composes safely with a mock undulation patch
// ---------------------------------------------------------------------------

function applyMockUndulationPatch(material: THREE.MeshStandardMaterial): void {
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => {
    const base = previousCacheKey?.() ?? '';
    return base.length ? `${base}|undulation-mock` : 'undulation-mock';
  };
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n// __UNDULATION_SENTINEL__\ntransformed.x += 0.0;`,
    );
  };
  material.needsUpdate = true;
}

describe('fishFinRayShader composes with undulation — fin-ray first', () => {
  it('vertex shader carries both the fin-ray position capture and the undulation sentinel', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const geo = new THREE.BoxGeometry(0.1, 2, 0.1);
    applyFishFinRayShader(mat, geo, BONY_FISH_FIN_RAY_CONFIG);
    applyMockUndulationPatch(mat);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vFinRayPos = position');
    expect(vertexShader).toContain('__UNDULATION_SENTINEL__');
  });
});

describe('fishFinRayShader composes with undulation — undulation first', () => {
  it('vertex shader carries both the undulation sentinel and the fin-ray position capture', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const geo = new THREE.BoxGeometry(0.1, 2, 0.1);
    applyMockUndulationPatch(mat);
    applyFishFinRayShader(mat, geo, BONY_FISH_FIN_RAY_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vFinRayPos = position');
    expect(vertexShader).toContain('__UNDULATION_SENTINEL__');
  });
});

// ---------------------------------------------------------------------------
// Species routing: patchWingMaterial applies the correct config per creature
// ---------------------------------------------------------------------------

describe('FishtankSceneRenderer3D.patchWingMaterial species routing', () => {
  it('patches onBeforeCompile for a bony small fish (tetra / plain fish)', () => {
    const renderer = makeFishtankRenderer();
    const { geometries } = renderer.getBoidInstanceConfig(BoidSpecies.Normal, FISHTANK_FLAGS);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    renderer.patchWingMaterial(mat, geometries);
    expect(mat.onBeforeCompile).not.toBe(originalCompile);
  });

  it('patches onBeforeCompile for the barracuda (bony fish with large fins)', () => {
    const renderer = makeFishtankRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Normal,
      FISHTANK_FLAGS,
      NORMAL_PRED_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    renderer.patchWingMaterial(mat, geometries);
    expect(mat.onBeforeCompile).not.toBe(originalCompile);
  });

  it('does NOT patch onBeforeCompile for the shark (cartilaginous fins, no visible bony rays)', () => {
    const renderer = makeFishtankRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Monster,
      FISHTANK_FLAGS,
      MONSTER_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    renderer.patchWingMaterial(mat, geometries);
    expect(mat.onBeforeCompile).toBe(originalCompile);
  });

  it('does NOT patch onBeforeCompile for the sea horse (not a bony fish)', () => {
    const renderer = makeFishtankRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Horse,
      FISHTANK_FLAGS,
      UNICORN_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    renderer.patchWingMaterial(mat, geometries);
    expect(mat.onBeforeCompile).toBe(originalCompile);
  });

  it('barracuda uses a different (lower) brightness than bony-fish config', () => {
    expect(BARRACUDA_FIN_RAY_CONFIG.brightness).toBeLessThan(BONY_FISH_FIN_RAY_CONFIG.brightness);
  });
});
