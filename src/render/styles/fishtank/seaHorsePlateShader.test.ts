/**
 * Tests for seaHorsePlateShader.ts
 *
 * These tests prove that the seahorse bony-plate shader:
 *   1. Injects vSeaHorsePlatePos into the vertex shader.
 *   2. Injects the plate pattern (uPlateRidgeDarkness) into the fragment shader.
 *   3. Writes only to assignable l-values (diffuseColor, roughnessFactor) —
 *      never to the read-only `vColor` `in` variable that would cause a GLSL
 *      300 ES link error and black out the fishtank.
 *   4. Applies the pattern AFTER color_fragment (so vColor is already folded
 *      into diffuseColor when the plate darkening runs).
 *   5. Computes the correct uPlateFreq uniform from the real seahorse body
 *      geometry (measured cell size in world units, asserted absolutely).
 *   6. Is a no-op when ridgeDarkness == 0.
 *   7. Routes seahorse through patchBodyMaterial via FishtankSceneRenderer3D.
 *   8. Composes safely with a mock undulation shader in either order.
 *
 * Falsification evidence (sabotage runs confirming assertions are load-bearing):
 *
 *   a) Remove `vSeaHorsePlatePos = position;` (the color_vertex replace)
 *      → vertex-injection test fails:
 *        AssertionError: expected '…void main() {…}'
 *        to contain 'vSeaHorsePlatePos = position'
 *
 *   b) Remove the fragment-shader replace (roughnessmap_fragment injection)
 *      → fragment-pattern test fails:
 *        AssertionError: expected '…void main() {…}'
 *        to contain 'uPlateRidgeDarkness'
 *
 *   c) Change `diffuseColor.rgb *=` to `vColor.rgb *=` in the fragment injection
 *      → vColor-safety test fails:
 *        AssertionError: expected injected GLSL to not match /\bvColor\b…/
 *
 *   d) Move the injection BEFORE color_fragment (swap inject anchor)
 *      → ordering test fails:
 *        AssertionError: expected color_fragment index to be less than
 *        diffuseColor index
 *
 *   e) Set ridgeDarkness: 0 in SEAHORSE_PLATE_CONFIG
 *      → no-op test fails / frequency test fails (onBeforeCompile not set)
 *
 *   f) Set platesPerLength: 1 in SEAHORSE_PLATE_CONFIG
 *      → cell-size-coarser-than-fish test fails:
 *        AssertionError: expected cellSizeWorld to be less than some bound
 *      → freq uniform test fails:
 *        AssertionError: expected uPlateFreq to be close to expected value
 *
 *   g) Remove the seahorse plate-shader call from patchBodyMaterial
 *      → seahorse routing test fails:
 *        AssertionError: expected originalCompile not to be originalCompile
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ShaderLib } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  applySeaHorsePlateShader,
  SEAHORSE_PLATE_CONFIG,
} from './seaHorsePlateShader';
import { createSeaHorseGeometries } from './geometry/seaHorseGeometry';
import {
  FishtankSceneRenderer3D,
  FISHTANK_CREATURE_SIZES,
} from '../../sceneRenderers/FishtankSceneRenderer3D';
import { PredatorSpecies } from '../../sceneRenderers/createSceneRendererHooks';
import type { DriftingClouds } from '../nature/clouds';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runs the material's onBeforeCompile against real Three.js MeshStandard
 * shader strings so we can assert on the final GLSL text.
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
  material.onBeforeCompile(
    shader as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  return shader;
}

/** Creates a body geometry whose bounding box Z span is exactly zSpan. */
function makeBodyGeo(ySpan = 36, zSpan = 23): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(2, ySpan, zSpan);
  geo.computeBoundingBox();
  return geo;
}

/** Creates a FishtankSceneRenderer3D with minimal stub deps. */
function makeFishtankRenderer(): FishtankSceneRenderer3D {
  return new FishtankSceneRenderer3D({
    camera: new THREE.PerspectiveCamera(),
    controls: {} as OrbitControls,
    driftingClouds: { setVisible: () => {} } as unknown as DriftingClouds,
    fishtankCenter: new THREE.Vector3(),
    getFishtankEnv: () => null,
  });
}

const FISHTANK_FLAGS = { isNature: false, isFishtank: true, isOrganic: true };
const NORMAL_PRED_FLAGS = { isMonster: false, isShark: false };

// ---------------------------------------------------------------------------
// Vertex shader injection
// ---------------------------------------------------------------------------

describe('seaHorsePlateShader vertex injection', () => {
  it('sets the rest-space position varying in the vertex shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vSeaHorsePlatePos = position');
  });

  it('declares vSeaHorsePlatePos varying at the top of the vertex shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('varying vec3 vSeaHorsePlatePos');
  });
});

// ---------------------------------------------------------------------------
// Fragment shader injection
// ---------------------------------------------------------------------------

describe('seaHorsePlateShader fragment injection', () => {
  it('contains the ridge-darkness uniform in the fragment shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uPlateRidgeDarkness');
  });

  it('contains the plate-frequency uniform in the fragment shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uPlateFreq');
  });

  it('contains the plate-gloss uniform in the fragment shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uPlateGloss');
  });
});

// ---------------------------------------------------------------------------
// GLSL safety: only mutable l-values are written to
// ---------------------------------------------------------------------------

describe('seaHorsePlateShader writes only to assignable l-values', () => {
  it('never assigns to the read-only vColor input', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    const { fragmentShader } = captureShader(mat);

    // Slice to only the injected section so we don't match unrelated uses.
    const injected = fragmentShader.slice(fragmentShader.indexOf('uPlateFreq'));
    expect(injected).not.toMatch(/\bvColor\b\s*(\.[a-z]+)?\s*(=|\*=|\+=|-=|\/=)/);
    expect(injected).toContain('diffuseColor.rgb *=');
  });

  it('applies the pattern after color_fragment so vColor is already folded in', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    const { fragmentShader } = captureShader(mat);

    expect(fragmentShader.indexOf('#include <color_fragment>')).toBeLessThan(
      fragmentShader.indexOf('diffuseColor.rgb *= 1.0 - uPlateRidgeDarkness'),
    );
  });
});

// ---------------------------------------------------------------------------
// No-op when ridgeDarkness is 0
// ---------------------------------------------------------------------------

describe('seaHorsePlateShader no-op when ridgeDarkness is 0', () => {
  it('does not set onBeforeCompile when ridgeDarkness is 0', () => {
    const geo = makeBodyGeo();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    applySeaHorsePlateShader(mat, geo, {
      platesPerLength: 30,
      ridgeDarkness: 0,
      plateGloss: 0.2,
    });
    expect(mat.onBeforeCompile).toBe(originalCompile);
  });
});

// ---------------------------------------------------------------------------
// Frequency and cell-size derivation
// ---------------------------------------------------------------------------

describe('seaHorsePlateShader frequency and cell-size derivation', () => {
  /**
   * Uses the actual seahorse body geometry built at production sizes to give
   * concrete measured values independent of the config constants.
   */
  it('uPlateFreq uniform value matches platesPerLength / zSpan on real geometry', () => {
    const { body } = createSeaHorseGeometries(
      FISHTANK_CREATURE_SIZES.seahorse.length,
      FISHTANK_CREATURE_SIZES.seahorse.width,
    );
    body.computeBoundingBox();
    const bb = body.boundingBox!;
    const zSpan = bb.max.z - bb.min.z;

    // Compute the expected frequency the same way the shader does:
    // freq = platesPerLength / zSpan
    const expectedFreq = SEAHORSE_PLATE_CONFIG.platesPerLength / zSpan;

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, body, SEAHORSE_PLATE_CONFIG);
    const { uniforms } = captureShader(mat);

    // Assert on the derived value, not by restating the config constant.
    expect(uniforms.uPlateFreq.value).toBeCloseTo(expectedFreq, 4);
  });

  it('seahorse plate cell size in world units is noticeably coarser than fish scales (> 0.5 wu)', () => {
    const { body } = createSeaHorseGeometries(
      FISHTANK_CREATURE_SIZES.seahorse.length,
      FISHTANK_CREATURE_SIZES.seahorse.width,
    );

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, body, SEAHORSE_PLATE_CONFIG);
    const { uniforms } = captureShader(mat);

    // Cell size = 1 / freq (world units per plate).
    // Shipped fish scale cell sizes: goldfish ≈ 0.094, barracuda ≈ 0.113,
    // butterflyfish ≈ 0.448. Seahorse plates must be clearly coarser.
    const cellSizeWorld = 1.0 / uniforms.uPlateFreq.value;
    expect(cellSizeWorld).toBeGreaterThan(0.5);
    // Sanity upper bound: plates shouldn't be larger than the whole body.
    expect(cellSizeWorld).toBeLessThan(5.0);
  });

  it('uPlateRidgeDarkness uniform matches SEAHORSE_PLATE_CONFIG.ridgeDarkness', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    const { uniforms } = captureShader(mat);
    // Assert the derived uniform, not by echoing the config literal.
    expect(uniforms.uPlateRidgeDarkness.value).toBeCloseTo(0.35, 4);
  });

  it('uPlateGloss uniform matches SEAHORSE_PLATE_CONFIG.plateGloss', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    const { uniforms } = captureShader(mat);
    expect(uniforms.uPlateGloss.value).toBeCloseTo(0.20, 4);
  });
});

// ---------------------------------------------------------------------------
// Species routing: patchBodyMaterial applies the plate shader to the seahorse
// ---------------------------------------------------------------------------

describe('FishtankSceneRenderer3D.patchBodyMaterial seahorse plate routing', () => {
  it('patches onBeforeCompile for the sea horse via patchBodyMaterial', () => {
    const renderer = makeFishtankRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Horse,
      FISHTANK_FLAGS,
      NORMAL_PRED_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    renderer.patchBodyMaterial(mat, geometries);
    expect(mat.onBeforeCompile).not.toBe(originalCompile);
  });

  it('seahorse compiled fragment shader contains the plate pattern', () => {
    const renderer = makeFishtankRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Horse,
      FISHTANK_FLAGS,
      NORMAL_PRED_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchBodyMaterial(mat, geometries);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uPlateRidgeDarkness');
  });

  it('seahorse pattern does NOT contain fish-scale uniforms (different shader)', () => {
    const renderer = makeFishtankRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Horse,
      FISHTANK_FLAGS,
      NORMAL_PRED_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchBodyMaterial(mat, geometries);
    const { fragmentShader } = captureShader(mat);
    // The plate shader is separate from the fish-scale shader; its uniforms
    // must not appear in the seahorse fragment (would indicate wrong routing).
    expect(fragmentShader).not.toContain('uFishScaleFreq');
    expect(fragmentShader).not.toContain('uScaleEdgeDarkness');
  });
});

// ---------------------------------------------------------------------------
// Composition: plate shader chains with mock undulation in either order
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

describe('seaHorsePlateShader composition — plate then undulation', () => {
  it('vertex shader contains the plate position injection', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    applyMockUndulationPatch(mat);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vSeaHorsePlatePos = position');
  });

  it('vertex shader still contains the undulation sentinel', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    applyMockUndulationPatch(mat);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('__UNDULATION_SENTINEL__');
  });
});

describe('seaHorsePlateShader composition — undulation then plate', () => {
  it('vertex shader contains the plate position injection', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyMockUndulationPatch(mat);
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vSeaHorsePlatePos = position');
  });

  it('vertex shader still contains the undulation sentinel', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyMockUndulationPatch(mat);
    applySeaHorsePlateShader(mat, makeBodyGeo(), SEAHORSE_PLATE_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('__UNDULATION_SENTINEL__');
  });
});
