/**
 * Composition tests for fishScaleShader.ts
 *
 * These tests prove four invariants that a bare "string contains X" check
 * cannot guarantee alone:
 *
 *   1. After both the scale patch and a mock-undulation patch are applied
 *      (in EITHER order), the compiled vertex shader carries BOTH injections.
 *   2. After composition, the fragment shader carries the scale pattern.
 *   3. The merged fish body geometries still carry their per-variant palette
 *      vertex colours (goldfish warm orange-gold; blue tang royal blue).
 *   4. Frequency derivation gives sane absolute cell counts on both axes
 *      (barracuda ≥ 3 crosswise cells; was 2.2 with the buggy max.y formula).
 *
 * Falsification evidence (sabotage runs confirming assertions are load-bearing):
 *
 *   a) Remove `previousCompile?.(shader, renderer)` from applyFishScaleShader
 *      → "scale then undulation" test fails:
 *        AssertionError: expected '…varying vec3 vFishScalePos;\n#version …'
 *        to contain '__UNDULATION_SENTINEL__'
 *
 *   b) Remove `vFishScalePos = position;` injection (the color_vertex replace)
 *      → injection tests fail:
 *        AssertionError: expected '…#version …void main() {…}'
 *        to contain 'vFishScalePos = position'
 *
 *   c) Remove the fragment-shader replace (color_fragment injection)
 *      → fragment test fails:
 *        AssertionError: expected '…void main() {…#include <color_fragment>…}'
 *        to contain 'uScaleEdgeDarkness'
 *
 *   d) Revert frequency to `scalesPerLength / max.y` (old buggy formula)
 *      → barracuda crosswise-cell test fails:
 *        AssertionError: expected 2.23 to be >= 3
 *      → barracuda cell-size test fails:
 *        AssertionError: expected 3.04 to be <= 2.5
 *
 *   e) Remove the seahorse early-return guard from patchBodyMaterial
 *      → seahorse routing test fails:
 *        AssertionError: expected [Function: bound onBeforeCompile]
 *        to be [Function: originalCompile]
 *
 *   f) Remove the shark SHARK_SCALE_CONFIG branch (fall through to bony-fish config)
 *      → shark routing test fails:
 *        AssertionError: expected [Function: bound onBeforeCompile]
 *        to be [Function: originalCompile]
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ShaderLib } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  applyFishScaleShader,
  BONY_FISH_SCALE_CONFIG,
  BARRACUDA_SCALE_CONFIG,
  SHARK_SCALE_CONFIG,
} from './fishScaleShader';
import {
  createGoldfishGeometries,
  createBlueTangGeometries,
  GOLDFISH_FISHTANK_PALETTE,
  BLUE_TANG_FISHTANK_PALETTE,
} from './geometry/smallFishGeometry';
import { createBarracudaGeometries } from './geometry/barracudaGeometry';
import {
  FishtankSceneRenderer3D,
  FISHTANK_CREATURE_SIZES,
} from '../../sceneRenderers/FishtankSceneRenderer3D';
import { BoidSpecies } from '../../../sim/Boid';
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
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}

/**
 * Minimal mock of the fish-undulation shader's onBeforeCompile chaining.
 * Injects __UNDULATION_SENTINEL__ into the vertex shader so the test can
 * verify the scale shader didn't clobber the undulation patch regardless of
 * application order.
 */
function applyMockUndulationPatch(material: THREE.MeshStandardMaterial): void {
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => {
    const base = previousCacheKey?.() ?? '';
    return base.length ? `${base}|undulation-mock` : 'undulation-mock';
  };
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    // Inject a sentinel into the vertex shader — simulates the undulation
    // displacement code that the real fishUndulationShader.ts would add.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n// __UNDULATION_SENTINEL__\ntransformed.x += 0.0;`,
    );
  };
  material.needsUpdate = true;
}

/**
 * Creates a box geometry with the given full Y and Z spans so tests can
 * control the dorsoventral (Z) extent that drives uFishScaleFreq.
 */
function makeBodyGeo(ySpan = 10, zSpan = 3): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(2, ySpan, zSpan);
  geo.computeBoundingBox();
  return geo;
}

// ---------------------------------------------------------------------------
// Composition: scale applied first, undulation second
// ---------------------------------------------------------------------------

describe('fishScaleShader composition — scale then undulation', () => {
  it('vertex shader contains the scale position injection', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    applyMockUndulationPatch(mat);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vFishScalePos = position');
  });

  it('vertex shader still contains the undulation sentinel', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    applyMockUndulationPatch(mat);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('__UNDULATION_SENTINEL__');
  });

  it('fragment shader contains the scale pattern uniform', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    applyMockUndulationPatch(mat);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('vColor.rgb *= 1.0 - uScaleEdgeDarkness');
  });
});

describe('fishScaleShader composition — undulation then scale', () => {
  it('vertex shader contains the scale position injection', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyMockUndulationPatch(mat);
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vFishScalePos = position');
  });

  it('vertex shader still contains the undulation sentinel', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyMockUndulationPatch(mat);
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('__UNDULATION_SENTINEL__');
  });

  it('fragment shader contains the scale pattern uniform', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyMockUndulationPatch(mat);
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('vColor.rgb *= 1.0 - uScaleEdgeDarkness');
  });
});

// ---------------------------------------------------------------------------
// Density: frequency is isotropic in world space — cell size is the same
// on both the spine axis and the dorsoventral axis for every species.
// ---------------------------------------------------------------------------

describe('fishScaleShader frequency gives sane absolute cell counts', () => {
  it('small fish (goldfish-like) gets higher scale frequency than elongated fish (barracuda-like)', () => {
    // Proportions derived from measured body bounding boxes:
    //   goldfish:   Y span ≈ 3.2,  Z span ≈ 1.9
    //   barracuda:  Y span ≈ 36.5, Z span ≈ 6.8
    const smallGeo = makeBodyGeo(3.2, 1.9);
    const largeGeo = makeBodyGeo(36.5, 6.8);

    const smallMat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const largeMat = new THREE.MeshStandardMaterial({ vertexColors: true });

    applyFishScaleShader(smallMat, smallGeo, BONY_FISH_SCALE_CONFIG);
    applyFishScaleShader(largeMat, largeGeo, BARRACUDA_SCALE_CONFIG);

    const smallFreq = captureShader(smallMat).uniforms.uFishScaleFreq.value;
    const largeFreq = captureShader(largeMat).uniforms.uFishScaleFreq.value;

    expect(smallFreq).toBeGreaterThan(largeFreq);
  });

  it('barracuda has >= 3 crosswise scale cells (was 2.2 with buggy max.y formula)', () => {
    // Uses actual barracuda geometry so the assertion reflects real mesh proportions.
    const { body } = createBarracudaGeometries(
      FISHTANK_CREATURE_SIZES.barracuda.length,
      FISHTANK_CREATURE_SIZES.barracuda.width,
    );
    body.computeBoundingBox();
    const bb = body.boundingBox!;
    const zSpan = bb.max.z - bb.min.z; // measured: ≈ 6.78

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, body, BARRACUDA_SCALE_CONFIG);
    const freq = captureShader(mat).uniforms.uFishScaleFreq.value;

    // crosswise cells = Z span × frequency. With the old max.y formula
    // (freq = 6/18.225 ≈ 0.329) this was 6.78 × 0.329 ≈ 2.23 — too few.
    const crosswiseCells = zSpan * freq;
    expect(crosswiseCells).toBeGreaterThanOrEqual(3);
  });

  it('barracuda cell size in world units is in a plausible range [0.3, 2.5]', () => {
    const { body } = createBarracudaGeometries(
      FISHTANK_CREATURE_SIZES.barracuda.length,
      FISHTANK_CREATURE_SIZES.barracuda.width,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, body, BARRACUDA_SCALE_CONFIG);
    const freq = captureShader(mat).uniforms.uFishScaleFreq.value;

    // With the old max.y formula: freq ≈ 0.329 → cell size ≈ 3.04 (> 2.5 → FAIL).
    const cellSizeWorld = 1.0 / freq;
    expect(cellSizeWorld).toBeGreaterThan(0.3);
    expect(cellSizeWorld).toBeLessThan(2.5);
  });

  it('goldfish cell size in world units is in a plausible range [0.05, 0.5]', () => {
    const { body } = createGoldfishGeometries(
      FISHTANK_CREATURE_SIZES.goldfish.length,
      FISHTANK_CREATURE_SIZES.goldfish.width,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, body, BONY_FISH_SCALE_CONFIG);
    const freq = captureShader(mat).uniforms.uFishScaleFreq.value;

    const cellSizeWorld = 1.0 / freq;
    expect(cellSizeWorld).toBeGreaterThan(0.05);
    expect(cellSizeWorld).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Shark no-op: edgeDarkness=0 skips patching entirely
// ---------------------------------------------------------------------------

describe('fishScaleShader shark no-op', () => {
  it('does not set onBeforeCompile when edgeDarkness is 0', () => {
    const geo = makeBodyGeo(20, 10);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    applyFishScaleShader(mat, geo, SHARK_SCALE_CONFIG);
    // SHARK_SCALE_CONFIG has edgeDarkness=0; no patch should be applied
    expect(mat.onBeforeCompile).toBe(originalCompile);
  });
});

// ---------------------------------------------------------------------------
// Species routing: patchBodyMaterial applies the correct config per creature
// ---------------------------------------------------------------------------

/**
 * Creates a FishtankSceneRenderer3D with the minimal stub deps required by
 * its constructor. The constructor only stores deps and creates geometries;
 * none of the deps are consulted for patchBodyMaterial or the instance-config
 * getters tested here.
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

/** Fishtank StyleFlags and PredatorRenderFlags for tests. */
const FISHTANK_FLAGS = { isNature: false, isFishtank: true, isOrganic: true };
const MONSTER_FLAGS = { isMonster: true, isShark: true };
const NORMAL_PRED_FLAGS = { isMonster: false, isShark: false };

describe('FishtankSceneRenderer3D.patchBodyMaterial species routing', () => {
  it('does NOT patch onBeforeCompile for the shark (denticles, not scales)', () => {
    const renderer = makeFishtankRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Monster,
      FISHTANK_FLAGS,
      MONSTER_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    renderer.patchBodyMaterial(mat, geometries);
    expect(mat.onBeforeCompile).toBe(originalCompile);
  });

  it('does NOT patch onBeforeCompile for the sea horse (not a fish)', () => {
    const renderer = makeFishtankRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Horse,
      FISHTANK_FLAGS,
      NORMAL_PRED_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    renderer.patchBodyMaterial(mat, geometries);
    expect(mat.onBeforeCompile).toBe(originalCompile);
  });

  it('patches onBeforeCompile for the barracuda', () => {
    const renderer = makeFishtankRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Normal,
      FISHTANK_FLAGS,
      NORMAL_PRED_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    renderer.patchBodyMaterial(mat, geometries);
    expect(mat.onBeforeCompile).not.toBe(originalCompile);
  });

  it.each([
    BoidSpecies.Normal,
    BoidSpecies.Gold,
    BoidSpecies.Red,
    BoidSpecies.Blue,
    BoidSpecies.Multicolor,
  ])('patches onBeforeCompile for boid species %s', (species) => {
    const renderer = makeFishtankRenderer();
    const { geometries } = renderer.getBoidInstanceConfig(species, FISHTANK_FLAGS);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    renderer.patchBodyMaterial(mat, geometries);
    expect(mat.onBeforeCompile).not.toBe(originalCompile);
  });
});

// ---------------------------------------------------------------------------
// Vertex colours: merged bodies still carry per-variant palette colours
// ---------------------------------------------------------------------------

describe('fishtank merged body vertex colours after geometry build', () => {
  it('goldfish body carries warm orange-gold vertex colours matching GOLDFISH_FISHTANK_PALETTE', () => {
    const length = 3.4;
    const width = 2.4;
    const { body } = createGoldfishGeometries(length, width);
    const colors = body.getAttribute('color') as THREE.BufferAttribute | null;
    expect(colors).not.toBeNull();
    // The goldfish back is the "back" color and belly is the "belly" color.
    // Verify at least one vertex matches the back colour (warm orange-gold,
    // R channel dominant) and at least one matches the belly colour (paler).
    const back = new THREE.Color(GOLDFISH_FISHTANK_PALETTE.back);
    const belly = new THREE.Color(GOLDFISH_FISHTANK_PALETTE.belly);
    let foundBackLike = false;
    let foundBellyLike = false;
    const tol = 0.1;
    for (let i = 0; i < colors!.count; i++) {
      const r = colors!.getX(i);
      const g = colors!.getY(i);
      const b = colors!.getZ(i);
      if (Math.abs(r - back.r) < tol && Math.abs(g - back.g) < tol && Math.abs(b - back.b) < tol) {
        foundBackLike = true;
      }
      if (Math.abs(r - belly.r) < tol && Math.abs(g - belly.g) < tol && Math.abs(b - belly.b) < tol) {
        foundBellyLike = true;
      }
    }
    expect(foundBackLike).toBe(true);
    expect(foundBellyLike).toBe(true);
  });

  it('blue tang body carries royal-blue vertex colours matching BLUE_TANG_FISHTANK_PALETTE', () => {
    const length = 6.825;
    const width = 4.68;
    const { body } = createBlueTangGeometries(length, width);
    const colors = body.getAttribute('color') as THREE.BufferAttribute | null;
    expect(colors).not.toBeNull();
    const bodyBlue = new THREE.Color(BLUE_TANG_FISHTANK_PALETTE.body);
    let foundBlue = false;
    const tol = 0.1;
    for (let i = 0; i < colors!.count; i++) {
      const r = colors!.getX(i);
      const g = colors!.getY(i);
      const bVal = colors!.getZ(i);
      if (Math.abs(r - bodyBlue.r) < tol && Math.abs(g - bodyBlue.g) < tol && Math.abs(bVal - bodyBlue.b) < tol) {
        foundBlue = true;
        break;
      }
    }
    expect(foundBlue).toBe(true);
  });
});
