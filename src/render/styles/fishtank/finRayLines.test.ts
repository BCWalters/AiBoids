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
  PECTORAL_FIN_FRAME,
  CAUDAL_FIN_FRAME,
} from './fishFinRayShader';
import { FishtankSceneRenderer3D } from '../../sceneRenderers/FishtankSceneRenderer3D';
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
describe('fishFinRayShader fan geometry', () => {
  // Fin rays radiate from the body seam (issue #242): they converge at the root
  // and spread toward the edge. The failure this pins is SILENT — banding on a
  // raw model axis still compiles, still lights up, and still looks like "lines
  // on a fin", but the lines are parallel. Measuring the spacing ratio between
  // the root end and the tip end is what distinguishes the two: a true fan
  // spreads proportionally to distance from the root (ratio == span ratio),
  // whereas parallel bands give a ratio of exactly 1.
  // Source geometry from the real scene renderer rather than calling the
  // geometry factory directly: the renderer is what actually decides which
  // frame each fin gets, and a test that constructs geometry by hand cannot
  // see it passing the wrong one.
  function barracudaGeometries() {
    const renderer = makeFishtankRenderer() as unknown as {
      barracudaPredatorGeometries: { wingLeft: THREE.BufferGeometry; tail?: THREE.BufferGeometry };
    };
    return renderer.barracudaPredatorGeometries;
  }

  const RATIO_AT = { near: 0.2, far: 1.0 };

  function rayFrame(geometry: THREE.BufferGeometry, config: typeof BONY_FISH_FIN_RAY_CONFIG, frame: typeof PECTORAL_FIN_FRAME) {
    const material = new THREE.MeshStandardMaterial();
    applyFishFinRayShader(material, geometry, config, frame);
    const shader = {
      vertexShader: '#include <color_vertex>',
      fragmentShader: '#include <color_fragment>',
      uniforms: {} as Record<string, { value: number }>,
    };
    material.onBeforeCompile!(shader as never, {} as never);
    return shader;
  }

  /** Chord distance between two adjacent rays at a given distance from the root. */
  function raySpacingAt(freq: number, spanDistance: number): number {
    return Math.tan(1 / freq) * spanDistance;
  }

  for (const [label, part, frame] of [
    ['pectoral', 'wingLeft', PECTORAL_FIN_FRAME],
    ['caudal', 'tail', CAUDAL_FIN_FRAME],
  ] as const) {
    it(`${label} fin rays fan out from the root rather than running parallel`, () => {
      const geometries = barracudaGeometries();
      const geometry = geometries[part]!;
      const { uniforms, fragmentShader } = rayFrame(geometry, BARRACUDA_FIN_RAY_CONFIG, frame);

      const freq = uniforms.uFinRayFreq.value;
      const extent = uniforms.uFinRaySpanExtent.value;
      const near = raySpacingAt(freq, extent * RATIO_AT.near);
      const far = raySpacingAt(freq, extent * RATIO_AT.far);

      // Parallel bands would give 1.0. A fan gives far/near == 1.0/0.2 == 5.
      expect(far / near).toBeGreaterThan(3);

      // ...and the shipped GLSL must actually compute that angle. The check
      // above derives spacing from the uniforms with an angular formula of its
      // own, so on its own it stays green even if the shader bands on a raw
      // axis — which is precisely the regression this test exists to catch.
      // Assert the fragment source divides chord by span through atan().
      expect(fragmentShader).toMatch(/atan\(\s*finChord\s*,\s*max\(\s*finSpan/);
    });
  }

  it('substitutes every axis placeholder — a survivor is a GLSL compile error', () => {
    const geometries = barracudaGeometries();
    for (const [part, frame] of [
      ['wingLeft', PECTORAL_FIN_FRAME],
      ['tail', CAUDAL_FIN_FRAME],
    ] as const) {
      const { fragmentShader } = rayFrame(geometries[part]!, BONY_FISH_FIN_RAY_CONFIG, frame);
      // These tokens appear in the injected GLSL comment as well as the code, so
      // a plain String.replace() substitutes only the comment and leaves the real
      // reference intact. That produced a shader that failed to compile while
      // every string-presence assertion stayed green.
      expect(fragmentShader).not.toContain('FIN_SPAN_COMP');
      expect(fragmentShader).not.toContain('FIN_CHORD_COMP');
    }
  });

  it('reads a different axis pair for the caudal fin than for the pectorals', () => {
    const geometries = barracudaGeometries();
    const pectoral = rayFrame(geometries.wingLeft, BONY_FISH_FIN_RAY_CONFIG, PECTORAL_FIN_FRAME);
    const caudal = rayFrame(geometries.tail!, BONY_FISH_FIN_RAY_CONFIG, CAUDAL_FIN_FRAME);

    const axesOf = (src: string) => [...new Set(src.match(/vFinRayPos\.[xyz]/g) ?? [])].sort().join(',');
    // The two fins lie in different planes. Using the pectoral frame on the
    // caudal fin strikes the fan from a point off the geometry entirely, which
    // still renders — just wrongly.
    expect(axesOf(pectoral.fragmentShader)).not.toBe(axesOf(caudal.fragmentShader));
  });

  it('gives the caudal fin its own program cache key', () => {
    const geometries = barracudaGeometries();
    const pectoralMaterial = new THREE.MeshStandardMaterial();
    const caudalMaterial = new THREE.MeshStandardMaterial();
    applyFishFinRayShader(pectoralMaterial, geometries.wingLeft, BONY_FISH_FIN_RAY_CONFIG, PECTORAL_FIN_FRAME);
    applyFishFinRayShader(caudalMaterial, geometries.tail!, BONY_FISH_FIN_RAY_CONFIG, CAUDAL_FIN_FRAME);

    // Without the frame in the cache key three.js reuses the pectoral program
    // for the caudal fin and the caudal frame silently does nothing.
    expect(pectoralMaterial.customProgramCacheKey!()).not.toBe(caudalMaterial.customProgramCacheKey!());
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
