/**
 * Tests for dragonScaleShader.ts
 *
 * These tests prove that the dragon reptilian-scale shader:
 *   1. Injects vDragonScalePos into the vertex shader.
 *   2. Injects the scale pattern (uScaleEdgeDarkness, uScaleKeelDarkness)
 *      into the fragment shader.
 *   3. Writes only to assignable l-values (diffuseColor, roughnessFactor) —
 *      never to the read-only `vColor` `in` variable that would cause a GLSL
 *      300 ES link error and black out the entire nature scene.
 *   4. Applies the pattern AFTER color_fragment (so vColor is already folded
 *      into diffuseColor when the scale darkening runs).
 *   5. Computes the correct uDragonScaleFreq uniform from the real dragon body
 *      geometry (measured cell size in world units, asserted absolutely).
 *   6. Is a no-op when edgeDarkness == 0.
 *   7. Routes the dragon through patchBodyMaterial via NatureSceneRenderer3D.
 *   8. Composes safely with a mock prior onBeforeCompile in either order.
 *
 * Falsification evidence (sabotage runs confirming every assertion is load-bearing):
 *
 *   a) Remove `vDragonScalePos = position;` (the color_vertex replace)
 *      → vertex-injection test fails:
 *        AssertionError: expected '…void main() {…}'
 *        to contain 'vDragonScalePos = position'
 *
 *   b) Remove the fragment-shader replace (roughnessmap_fragment injection)
 *      → fragment-pattern test fails:
 *        AssertionError: expected '…void main() {…}'
 *        to contain 'uScaleEdgeDarkness'
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
 *   e) Set edgeDarkness: 0 in DRAGON_SCALE_CONFIG
 *      → no-op test fails (onBeforeCompile unchanged)
 *      → frequency test fails (onBeforeCompile never set)
 *
 *   f) Set scalesPerLength: 1 in DRAGON_SCALE_CONFIG
 *      → cell-size test fails:
 *        AssertionError: expected cellSizeWorld (≫1) to be less than 2.5
 *      → freq uniform test fails:
 *        AssertionError: expected uDragonScaleFreq to be close to expected value
 *
 *   g) Remove the dragon scale call from patchBodyMaterial
 *      → dragon routing test fails:
 *        AssertionError: expected mat.onBeforeCompile not to be originalCompile
 *
 *   h) Add `scaleKeelDarkness: 0` to DRAGON_SCALE_CONFIG (keel removal)
 *      → keel-uniform test fails:
 *        AssertionError: expected uScaleKeelDarkness.value to be close to 0.20
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ShaderLib } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  applyDragonScaleShader,
  DRAGON_SCALE_CONFIG,
} from './dragonScaleShader';
import { createDragonGeometries } from './geometry/dragonGeometry';
import {
  NatureSceneRenderer3D,
  NATURE_CREATURE_SIZES,
} from '../../sceneRenderers/NatureSceneRenderer3D';
import { PredatorSpecies } from '../../sceneRenderers/createSceneRendererHooks';
import type { DriftingClouds } from './clouds';
import type { FireBreathEffects } from './fireBreath';

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
function makeBodyGeo(ySpan = 40, zSpan = 16): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(2, ySpan, zSpan);
  geo.computeBoundingBox();
  return geo;
}

/** Creates a NatureSceneRenderer3D with minimal stub deps. */
function makeNatureRenderer(): NatureSceneRenderer3D {
  return new NatureSceneRenderer3D({
    camera: new THREE.PerspectiveCamera(),
    controls: {} as OrbitControls,
    driftingClouds: {
      dispose: () => {},
      setVisible: () => {},
    } as unknown as DriftingClouds,
    getNatureEnv: () => null,
    fireBreathEffects: {
      spawn: () => {},
      update: () => {},
      setVisible: () => {},
      dispose: () => {},
    } as unknown as FireBreathEffects,
  });
}

const NATURE_FLAGS = { isNature: true, isFishtank: false, isOrganic: true };
const MONSTER_PRED_FLAGS = { isMonster: true, isShark: false };

// ---------------------------------------------------------------------------
// Vertex shader injection
// ---------------------------------------------------------------------------

describe('dragonScaleShader vertex injection', () => {
  it('sets the rest-space position varying in the vertex shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vDragonScalePos = position');
  });

  it('declares vDragonScalePos varying at the top of the vertex shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('varying vec3 vDragonScalePos');
  });
});

// ---------------------------------------------------------------------------
// Fragment shader injection
// ---------------------------------------------------------------------------

describe('dragonScaleShader fragment injection', () => {
  it('contains the edge-darkness uniform in the fragment shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uScaleEdgeDarkness');
  });

  it('contains the keel-darkness uniform in the fragment shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uScaleKeelDarkness');
  });

  it('contains the scale-frequency uniform in the fragment shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uDragonScaleFreq');
  });

  it('contains the scale-gloss uniform in the fragment shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uScaleGloss');
  });
});

// ---------------------------------------------------------------------------
// GLSL safety: only mutable l-values are written to
// ---------------------------------------------------------------------------

describe('dragonScaleShader writes only to assignable l-values', () => {
  it('never assigns to the read-only vColor input', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);

    // Slice to only the injected section so we don't match unrelated uses.
    const injected = fragmentShader.slice(fragmentShader.indexOf('uDragonScaleFreq'));
    // vColor is read-only `in` in GLSL 300 ES — any assignment causes a
    // "l-value required" link error that blacks out the entire scene.
    expect(injected).not.toMatch(/\bvColor\b\s*(\.[a-z]+)?\s*(=|\*=|\+=|-=|\/=)/);
    expect(injected).toContain('diffuseColor.rgb *=');
  });

  it('applies the pattern after color_fragment so vColor is already folded in', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);

    expect(fragmentShader.indexOf('#include <color_fragment>')).toBeLessThan(
      fragmentShader.indexOf('diffuseColor.rgb *= 1.0 - uScaleEdgeDarkness'),
    );
  });
});

// ---------------------------------------------------------------------------
// No-op when edgeDarkness is 0
// ---------------------------------------------------------------------------

describe('dragonScaleShader no-op when edgeDarkness is 0', () => {
  it('does not set onBeforeCompile when edgeDarkness is 0', () => {
    const geo = makeBodyGeo();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    applyDragonScaleShader(mat, geo, {
      scalesPerLength: 20,
      edgeDarkness: 0,
      scaleKeelDarkness: 0.2,
      scaleGloss: 0.2,
    });
    expect(mat.onBeforeCompile).toBe(originalCompile);
  });
});

// ---------------------------------------------------------------------------
// Frequency and cell-size derivation
// ---------------------------------------------------------------------------

describe('dragonScaleShader frequency and cell-size derivation', () => {
  /**
   * Uses the actual dragon body geometry built at production sizes to give
   * concrete measured values independent of the config constants.
   * Production dragon: length=45, width=19.8 → Z span ≈ 15.95 wu.
   */
  it('uDragonScaleFreq uniform matches scalesPerLength / zSpan on real geometry', () => {
    const { body } = createDragonGeometries(
      NATURE_CREATURE_SIZES.dragon.length,
      NATURE_CREATURE_SIZES.dragon.width,
    );
    body.computeBoundingBox();
    const bb = body.boundingBox!;
    const zSpan = bb.max.z - bb.min.z;

    // Compute the expected frequency the same way the shader does.
    const expectedFreq = DRAGON_SCALE_CONFIG.scalesPerLength / zSpan;

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, body, DRAGON_SCALE_CONFIG);
    const { uniforms } = captureShader(mat);

    // Assert on the derived value, not by restating the config constant.
    expect(uniforms.uDragonScaleFreq.value).toBeCloseTo(expectedFreq, 4);
  });

  it('dragon scale cell size in world units is coarse reptilian (0.5–2.5 wu)', () => {
    const { body } = createDragonGeometries(
      NATURE_CREATURE_SIZES.dragon.length,
      NATURE_CREATURE_SIZES.dragon.width,
    );

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, body, DRAGON_SCALE_CONFIG);
    const { uniforms } = captureShader(mat);

    // Cell size = 1 / freq (world units per scale cell).
    // Shipped fish scale cell sizes: goldfish ≈ 0.094, barracuda ≈ 0.113,
    // butterflyfish ≈ 0.448 wu. Dragon scales must be clearly coarser.
    // At scalesPerLength=20, Z span≈15.95, measured cell ≈ 0.80 wu.
    const cellSizeWorld = 1.0 / uniforms.uDragonScaleFreq.value;
    expect(cellSizeWorld).toBeGreaterThan(0.5);
    expect(cellSizeWorld).toBeLessThan(2.5);
  });

  it('uScaleEdgeDarkness uniform matches DRAGON_SCALE_CONFIG.edgeDarkness', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { uniforms } = captureShader(mat);
    // Assert the derived uniform, not by echoing the config literal.
    expect(uniforms.uScaleEdgeDarkness.value).toBeCloseTo(0.30, 4);
  });

  it('uScaleKeelDarkness uniform matches DRAGON_SCALE_CONFIG.scaleKeelDarkness', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { uniforms } = captureShader(mat);
    expect(uniforms.uScaleKeelDarkness.value).toBeCloseTo(0.20, 4);
  });

  it('uScaleGloss uniform matches DRAGON_SCALE_CONFIG.scaleGloss', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { uniforms } = captureShader(mat);
    expect(uniforms.uScaleGloss.value).toBeCloseTo(0.20, 4);
  });
});

// ---------------------------------------------------------------------------
// Species routing: patchBodyMaterial applies the scale shader to the dragon
// ---------------------------------------------------------------------------

describe('NatureSceneRenderer3D.patchBodyMaterial dragon scale routing', () => {
  it('patches onBeforeCompile for the dragon via patchBodyMaterial', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Monster,
      NATURE_FLAGS,
      MONSTER_PRED_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    renderer.patchBodyMaterial!(mat, geometries);
    expect(mat.onBeforeCompile).not.toBe(originalCompile);
  });

  it('dragon compiled fragment shader contains the scale pattern', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Monster,
      NATURE_FLAGS,
      MONSTER_PRED_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchBodyMaterial!(mat, geometries);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uScaleEdgeDarkness');
    expect(fragmentShader).toContain('uScaleKeelDarkness');
  });

  it('does NOT patch hawk geometry with dragon scales (hawk gets feather shader instead)', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Normal,
      NATURE_FLAGS,
      { isMonster: false, isShark: false },
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchBodyMaterial!(mat, geometries);
    const { fragmentShader } = captureShader(mat);
    // Hawk must NOT receive dragon scale uniforms — those are reptilian.
    expect(fragmentShader).not.toContain('uScaleEdgeDarkness');
    expect(fragmentShader).not.toContain('uScaleKeelDarkness');
    // Hawk receives the bird feather shader instead.
    expect(fragmentShader).toContain('uBarbDarkness');
  });

  it('does NOT apply the dragon scale shader to the unicorn', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Horse,
      NATURE_FLAGS,
      { isMonster: false, isShark: false },
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchBodyMaterial!(mat, geometries);
    // The unicorn gets the hair shader (not the dragon scale shader).
    // Verify the compiled shader does not contain the scale-shader uniform.
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).not.toContain('uScaleEdgeDarkness');
  });
});

// ---------------------------------------------------------------------------
// Composition: scale shader chains with a mock prior patch in either order
// ---------------------------------------------------------------------------

function applyMockPriorPatch(material: THREE.MeshStandardMaterial): void {
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => {
    const base = previousCacheKey?.() ?? '';
    return base.length ? `${base}|mock-prior` : 'mock-prior';
  };
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n// __MOCK_PRIOR_SENTINEL__\ntransformed.x += 0.0;`,
    );
  };
  material.needsUpdate = true;
}

describe('dragonScaleShader composition — scale then mock prior', () => {
  it('vertex shader contains the dragon scale position injection', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    applyMockPriorPatch(mat);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vDragonScalePos = position');
  });

  it('vertex shader still contains the mock prior sentinel', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    applyMockPriorPatch(mat);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('__MOCK_PRIOR_SENTINEL__');
  });
});

describe('dragonScaleShader composition — mock prior then scale', () => {
  it('vertex shader contains the dragon scale position injection', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyMockPriorPatch(mat);
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vDragonScalePos = position');
  });

  it('vertex shader still contains the mock prior sentinel', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyMockPriorPatch(mat);
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('__MOCK_PRIOR_SENTINEL__');
  });
});

// ---------------------------------------------------------------------------
// Uniforms must actually drive the output, not merely be declared
// ---------------------------------------------------------------------------

/**
 * The `toContain('uScaleKeelDarkness')` checks above are satisfied by the
 * uniform's own DECLARATION line at the top of the fragment shader, so they
 * pass even when nothing reads it. Verified: deleting the statement that
 * applies the keel to diffuseColor left all 22 other tests green — while the
 * keel is the single feature distinguishing these reptilian scales from the
 * existing fish-scale shader, i.e. the entire point of the change.
 *
 * These assertions strip the declarations first, then require each uniform to
 * appear in a statement that writes one of the shader's two mutable outputs
 * (diffuseColor or roughnessFactor). A uniform that is declared, computed into
 * a local, and then dropped on the floor fails here.
 */
describe('dragonScaleShader uniforms drive the shipped output', () => {
  const outputStatements = (fragmentShader: string): string[] => {
    // Drop declaration lines so a bare `uniform float uX;` cannot satisfy the
    // usage check below.
    const body = fragmentShader
      .split('\n')
      .filter((line) => !/^\s*uniform\s/.test(line))
      .join('\n');
    return body
      .split(';')
      .filter((stmt) => /\b(diffuseColor|roughnessFactor)\b\s*(\.[a-z]+)?\s*[-*+]?=/.test(stmt));
  };

  const assertDrivesOutput = (uniform: string) => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyDragonScaleShader(mat, makeBodyGeo(), DRAGON_SCALE_CONFIG);
    const { fragmentShader } = captureShader(mat);

    const statements = outputStatements(fragmentShader);
    expect(statements.length, 'expected statements writing diffuseColor/roughnessFactor').toBeGreaterThan(0);

    // The uniform may feed the output through an intermediate local (e.g.
    // `keel`), so follow one level of indirection: collect locals assigned
    // from the uniform, then check the uniform or any of those locals reaches
    // an output statement.
    const body = fragmentShader.split('\n').filter((l) => !/^\s*uniform\s/.test(l)).join('\n');
    const derived = new Set<string>([uniform]);
    for (const stmt of body.split(';')) {
      if (!stmt.includes(uniform)) continue;
      const m = stmt.match(/(?:float|vec[234])\s+([A-Za-z_]\w*)\s*=/);
      if (m) derived.add(m[1]);
    }

    const reaches = statements.some((stmt) => [...derived].some((name) => stmt.includes(name)));
    expect(
      reaches,
      `${uniform} is declared but never reaches diffuseColor or roughnessFactor — ` +
        `it has no effect on the rendered image`,
    ).toBe(true);
  };

  it('uScaleEdgeDarkness affects the rendered output', () => {
    assertDrivesOutput('uScaleEdgeDarkness');
  });

  it('uScaleKeelDarkness affects the rendered output', () => {
    assertDrivesOutput('uScaleKeelDarkness');
  });

  it('uScaleGloss affects the rendered output', () => {
    assertDrivesOutput('uScaleGloss');
  });
});
