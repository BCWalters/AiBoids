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
 *   e) Remove the seahorse plate-shader call from patchBodyMaterial (revert to early-return)
 *      → seahorse routing test fails:
 *        AssertionError: expected [Function: originalCompile]
 *        not to be [Function: originalCompile]
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
  FISH_SCALE_RADIUS,
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
    expect(fragmentShader).toContain('diffuseColor.rgb *= 1.0 - uScaleEdgeDarkness');
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
    expect(fragmentShader).toContain('diffuseColor.rgb *= 1.0 - uScaleEdgeDarkness');
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

  it('barracuda cell size in world units is in a plausible range [0.05, 0.5]', () => {
    const { body } = createBarracudaGeometries(
      FISHTANK_CREATURE_SIZES.barracuda.length,
      FISHTANK_CREATURE_SIZES.barracuda.width,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, body, BARRACUDA_SCALE_CONFIG);
    const freq = captureShader(mat).uniforms.uFishScaleFreq.value;

    // With the old max.y formula: freq ≈ 0.329 → cell size ≈ 3.04 (→ FAIL).
    //
    // The window matches the goldfish's, deliberately. Barracuda density was
    // raised 6 → 60 after visual review, which puts its cell at 0.113 world
    // units -- slightly LARGER than the already-shipped goldfish at 0.094, so
    // this is the same visual regime rather than a new sub-pixel risk. The
    // previous [0.3, 2.5] window was calibrated to the old density only.
    const cellSizeWorld = 1.0 / freq;
    expect(cellSizeWorld).toBeGreaterThan(0.05);
    expect(cellSizeWorld).toBeLessThan(0.5);
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

/**
 * three.js upgrades these WebGL1-style shaders to GLSL 300 ES, where a
 * `varying` becomes an `in` in the fragment stage. Inputs are read-only, so
 * assigning to vColor links with
 *   ERROR: 'assign' : l-value required (can't modify an input "vColor")
 * and every fishtank material fails to compile — a black scene, caught only
 * by the e2e because a shader-string test cannot compile GLSL.
 *
 * The pattern must therefore modulate `diffuseColor` (a local vec4) after
 * color_fragment has folded vColor in, never vColor itself.
 */
describe('fishScaleShader writes only to assignable l-values', () => {
  it('never assigns to the read-only vColor input', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);

    const injected = fragmentShader.slice(fragmentShader.indexOf('uFishScaleFreq'));
    expect(injected).not.toMatch(/\bvColor\b\s*(\.[a-z]+)?\s*(=|\*=|\+=|-=|\/=)/);
    expect(injected).toContain('diffuseColor.rgb *=');
  });

  it('applies the pattern after color_fragment so vColor is already folded in', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);

    expect(fragmentShader.indexOf('#include <color_fragment>')).toBeLessThan(
      fragmentShader.indexOf('diffuseColor.rgb *= 1.0 - uScaleEdgeDarkness'),
    );
  });
});

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

  it('patches onBeforeCompile for the sea horse (bony plates, not fish scales)', () => {
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

// ---------------------------------------------------------------------------
// JS port of the fragment-shader maths for numerical sampling
//
// These helpers mirror the GLSL in fishScaleShader.ts exactly so tests can
// assert on concrete pixel-level values without running a GPU.
// ---------------------------------------------------------------------------

/**
 * GLSL fract: x − floor(x), always in [0, 1).
 * JavaScript's modulo can return negative values for negative inputs, so we
 * use subtraction from floor to match GLSL behaviour precisely.
 */
function glslFract(x: number): number {
  return x - Math.floor(x);
}

/** GLSL smoothstep with the Hermite polynomial clamp. */
function glslSmoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Evaluates the fragment-shader scale pattern at a single (y, z, freq) point.
 *
 * Mirrors the GLSL block injected after #include <roughnessmap_fragment> in
 * applyFishScaleShader, using the same constants (kScaleR = FISH_SCALE_RADIUS,
 * ellipse Y factor = 1.25, smoothstep widths). No GPU required.
 *
 * Returns:
 *   r        – elliptical radius from this cell's scale centre (0 = centre)
 *   rAbove   – elliptical radius to the row-above scale centre
 *   visible  – 0 = hidden beneath row above, 1 = exposed crescent
 *   edge     – 0..1 free-edge arc intensity
 *   glossFactor – max(0, 1 − r/kR) × visible (multiply by uScaleGloss to
 *                  get the roughnessFactor reduction)
 */
function evalScale(
  y: number,
  z: number,
  freq: number,
): { r: number; rAbove: number; visible: number; edge: number; glossFactor: number } {
  const spx = y * freq;
  const spy = z * freq + Math.floor(spx) * 0.5;
  const fpx = glslFract(spx) - 0.5;
  const fpy = glslFract(spy) - 0.5;
  const kR = FISH_SCALE_RADIUS; // 0.62

  const r = Math.sqrt(fpx * fpx + (fpy * 1.25) ** 2);
  const rAbove = Math.sqrt((fpx + 1.0) ** 2 + (fpy * 1.25) ** 2);

  const visible = glslSmoothstep(kR - 0.04, kR + 0.04, rAbove);
  const edge = glslSmoothstep(kR - 0.10, kR, r) * (1 - glslSmoothstep(kR, kR + 0.06, r));
  const glossFactor = Math.max(0, 1 - r / kR) * visible;

  return { r, rAbove, visible, edge, glossFactor };
}

// ---------------------------------------------------------------------------
// Overlap — shingled crescent: the head-facing half of each scale is hidden
// by the row above, so only the exposed tail-facing crescent arc is visible.
//
// Falsification evidence (sabotage runs):
//
//   g) Replace `visible = smoothstep(kScaleR-0.04, kScaleR+0.04, rAbove)`
//      with `visible = 1.0` (remove occlusion) and re-run evalScale in JS:
//      → "head-facing half hidden" test fails:
//        AssertionError: expected 1 not to be 0
//        (visible is 1 instead of 0 at y=0.02)
//
//   h) Replace `visible = smoothstep(...)` with `visible = 0.0`:
//      → "tail-facing arc exposed" test fails:
//        AssertionError: expected 0 not to be 1
//        (visible is 0 instead of 1 at y=0.90)
//
//   i) Remove `float rAbove = ...` and the occlusion term:
//      → "full-body scan shows crescent" test fails:
//        AssertionError: expected false to be true
//        (anyHidden stays false — no cell is ever hidden)
// ---------------------------------------------------------------------------

describe('fishScaleShader overlap — shingled crescent (no full circles)', () => {
  it('the head-facing (toward-head) portion of a scale is hidden by the row above', () => {
    // At y=0.02, z=0.5, freq=1 we are inside the current scale's circle
    // (r=0.48 < kScaleR=0.62) but the row-above circle covers this point
    // (rAbove=0.52 < kScaleR−0.04=0.58 → smoothstep clamps to 0).
    // Absolute anchor: visible must be exactly 0 (not just small).
    const { r, rAbove, visible } = evalScale(0.02, 0.5, 1);
    expect(r).toBeLessThan(FISH_SCALE_RADIUS);        // confirms we are inside a scale
    expect(rAbove).toBeLessThan(FISH_SCALE_RADIUS - 0.04); // confirms fully covered
    expect(visible).toBe(0);                           // absolute: exactly hidden
  });

  it('the tail-facing (exposed crescent) portion of a scale is visible', () => {
    // At y=0.9, z=0.5, freq=1 we are inside the scale (r=0.4 < kScaleR)
    // and the row-above circle is far away (rAbove=1.4 > kScaleR+0.04=0.66
    // → smoothstep clamps to 1).
    // Absolute anchor: visible must be exactly 1 (not just large).
    const { r, rAbove, visible } = evalScale(0.9, 0.5, 1);
    expect(r).toBeLessThan(FISH_SCALE_RADIUS);         // inside the scale
    expect(rAbove).toBeGreaterThan(FISH_SCALE_RADIUS + 0.04); // well clear of occlusion
    expect(visible).toBe(1);                            // absolute: fully exposed
  });

  it('scanning a full spine traversal at constant Z shows a crescent, not a complete circle', () => {
    // For the same Z (through the scale centre at z=0.5, freq=1), scan y
    // from 0 to 1. Both a hidden region and a visible region must exist
    // inside the scale circle. A complete circle would have visible=1
    // everywhere inside — this test catches that regression.
    let anyHiddenInsideScale = false;
    let anyVisibleInsideScale = false;
    for (let i = 0; i <= 200; i++) {
      const y = i / 200;
      const { r, visible } = evalScale(y, 0.5, 1);
      if (r < FISH_SCALE_RADIUS) {
        if (visible < 0.1) anyHiddenInsideScale = true;
        if (visible > 0.9) anyVisibleInsideScale = true;
      }
    }
    expect(anyHiddenInsideScale).toBe(true);  // some of the scale is covered
    expect(anyVisibleInsideScale).toBe(true); // some of the scale is exposed
  });

  it('the fragment shader contains the occlusion rAbove term', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);
    // rAbove must appear in the injected block — a bare ring pattern that
    // never samples the row-above scale cannot produce a crescent.
    expect(fragmentShader).toContain('rAbove');
    expect(fragmentShader).toContain('fp.x + 1.0');
  });
});

// ---------------------------------------------------------------------------
// Stagger — adjacent spine rows are offset by half a cell in Z so arcs
// interlock in a brick/hex layout rather than lining up in a square grid.
//
// Falsification evidence:
//
//   j) Remove `sp.y += floor( sp.x ) * 0.5` from the GLSL and from evalScale:
//      → "row 1 centre at z=0.0" test fails:
//        AssertionError: expected 0.5 to be 0
//        (without stagger the row-1 centre stays at z=0.5, not z=0.0)
// ---------------------------------------------------------------------------

describe('fishScaleShader stagger — alternate rows offset by half a cell', () => {
  it('row 0 scale centre is at z=0.5 (freq=1)', () => {
    // With stagger=0 (floor(0.5)*0.5=0), fp=(0,0) when y=0.5, z=0.5 → r=0.
    // Absolute anchor: r must be exactly 0 at the centre.
    const { r } = evalScale(0.5, 0.5, 1);
    expect(r).toBe(0); // absolute: exactly at the scale centre
  });

  it('row 1 scale centre shifts to z=0.0 (freq=1) — half-cell stagger', () => {
    // With stagger=0.5 (floor(1.5)*0.5=0.5), fp=(0,0) when y=1.5, z=0.0 → r=0.
    // Absolute anchor: r must be exactly 0 at the row-1 centre.
    const { r } = evalScale(1.5, 0.0, 1);
    expect(r).toBe(0); // absolute: exactly at the scale centre
  });

  it('z=0.5 in row 1 is NOT a scale centre — it falls in a gap between scales', () => {
    // If there were no stagger, z=0.5 would be the centre in every row.
    // With half-cell stagger the row-1 centre is at z=0.0, so z=0.5
    // is displaced by half a cell (r ≈ 0.625 > kScaleR → outside the scale).
    const { r } = evalScale(1.5, 0.5, 1);
    expect(r).toBeGreaterThan(0); // not at centre
    expect(r).toBeGreaterThan(FISH_SCALE_RADIUS); // in fact outside the scale
  });

  it('rows 0 and 2 have the same z-centre (even rows align)', () => {
    // stagger for row 2 = floor(2.5)*0.5 = 2*0.5 = 1.0 → fract absorbs it
    // so row-2 centres fall back to z=0.5, same as row 0.
    const { r: r0 } = evalScale(0.5, 0.5, 1);
    const { r: r2 } = evalScale(2.5, 0.5, 1);
    expect(r0).toBe(0);
    expect(r2).toBe(0); // absolute: same alignment as row 0
  });
});

// ---------------------------------------------------------------------------
// Reflectivity — scale centres reduce roughnessFactor for subtle highlights
//
// Falsification evidence:
//
//   k) Remove the line `roughnessFactor = clamp( roughnessFactor - scaleGloss, …)`
//      → "scale centre has positive glossFactor" test fails:
//        AssertionError: expected 0 to be > 0
//
//   l) Remove `uScaleGloss` from Object.assign(shader.uniforms, …):
//      → "uScaleGloss uniform is set" test fails:
//        AssertionError: expected undefined to have a property 'value'
//
//   m) Move the roughness injection BEFORE roughnessmap_fragment:
//      → "roughnessFactor modified after roughnessmap_fragment" test fails:
//        AssertionError: expected [rough index] to be < [rF index]
//        (indices inverted)
//
//   n) Replace `roughnessFactor = clamp(roughnessFactor - scaleGloss, …)`
//      with `roughness -= scaleGloss` (writing to the uniform instead):
//      → "roughness guard" test fails:
//        AssertionError: expected injected code not to match /\broughness\b\s*[-]=\s*\w/
// ---------------------------------------------------------------------------

describe('fishScaleShader reflectivity — roughnessFactor modulation', () => {
  it('scale centres have a positive gloss factor (JS math)', () => {
    // At (y=0.5, z=0.5, freq=1) we are at the exact scale centre (r=0,
    // visible=1). glossFactor = max(0, 1−0/kR) × 1 = 1.0 exactly.
    // Absolute anchor: glossFactor is 1.
    const { r, visible, glossFactor } = evalScale(0.5, 0.5, 1);
    expect(r).toBe(0);
    expect(visible).toBe(1);
    expect(glossFactor).toBe(1);                          // absolute: maximum gloss at centre
    // Sanity-check the config value so the test can't pass with scaleGloss=0.
    expect(BONY_FISH_SCALE_CONFIG.scaleGloss).toBeGreaterThan(0.1); // absolute lower bound
  });

  it('the gap between scales has zero gloss factor (JS math)', () => {
    // At (y=0.9, z=0, freq=1) we are outside the scale (r>kScaleR) even
    // though visible=1. max(0, 1−r/kR)=0 so glossFactor=0.
    const { r, visible, glossFactor } = evalScale(0.9, 0.0, 1);
    expect(r).toBeGreaterThan(FISH_SCALE_RADIUS); // outside the scale
    expect(visible).toBeGreaterThan(0);            // not hidden by row above
    expect(glossFactor).toBe(0);                   // absolute: no gloss in gap
  });

  it('uScaleGloss uniform is set to the config value', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    const { uniforms } = captureShader(mat);
    expect(uniforms.uScaleGloss).toBeDefined();
    expect(uniforms.uScaleGloss.value).toBeCloseTo(BONY_FISH_SCALE_CONFIG.scaleGloss, 5);
  });

  it('fragment shader modifies roughnessFactor after roughnessmap_fragment', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);
    const roughnessmapIdx = fragmentShader.indexOf('#include <roughnessmap_fragment>');
    const rfClampIdx = fragmentShader.indexOf('roughnessFactor = clamp(');
    expect(roughnessmapIdx).toBeGreaterThan(-1);
    expect(rfClampIdx).toBeGreaterThan(-1);
    // roughnessmap_fragment must precede the clamp so roughnessFactor is
    // already declared as a local when we write to it.
    expect(roughnessmapIdx).toBeLessThan(rfClampIdx);
  });

  it('roughness guard — writes to roughnessFactor (local), not roughness (uniform)', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);
    // Slice from the first injected symbol so we only check our additions.
    const injected = fragmentShader.slice(fragmentShader.indexOf('uFishScaleFreq'));
    // Must contain a write to roughnessFactor (the local float).
    expect(injected).toContain('roughnessFactor = clamp(');
    // Must NOT contain a direct assignment to `roughness` (the uniform),
    // which is read-only and would silently miscompile or crash.
    expect(injected).not.toMatch(/\broughness\s*[-*+]?=/);
  });

  it('fragment shader colour modulation still precedes roughness modulation', () => {
    // diffuseColor *= … must come before roughnessFactor = … in the same
    // injected block, so colour and reflectivity are applied consistently.
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyFishScaleShader(mat, makeBodyGeo(), BONY_FISH_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader.indexOf('diffuseColor.rgb *= 1.0 - uScaleEdgeDarkness')).toBeLessThan(
      fragmentShader.indexOf('roughnessFactor = clamp('),
    );
  });
});
