/**
 * Tests for birdFeatherShader.ts
 *
 * These tests prove that the bird feather shader:
 *   1. Injects vBirdFeatherPos into the vertex shader.
 *   2. Injects the feather pattern (uBarbDarkness, uBarbGloss) into the fragment
 *      shader.
 *   3. Writes only to assignable l-values (diffuseColor, roughnessFactor) —
 *      never to the read-only `vColor` `in` variable that would cause a GLSL
 *      300 ES link error and black out the entire nature scene.
 *   4. Applies the pattern AFTER color_fragment (so vColor is already folded
 *      into diffuseColor when the barb darkening runs).
 *   5. Computes the correct uBarbFreq uniform from real bird geometry (measured
 *      cell size in world units, asserted absolutely).
 *   6. Is a no-op when barbDarkness == 0.
 *   7. Routes bird boids through patchBodyMaterial via NatureSceneRenderer3D.
 *   8. Composes safely with a mock prior onBeforeCompile in either order.
 *   9. (Required) material.clone() drops the shader patch — confirming the
 *      Renderer3D "clone-first then patch" rule is essential.
 *  10. (Required) body and wing materials have different cache keys when the
 *      patternPlane differs — confirming cache-key collision does not occur.
 *  11. (Required) renderer uses 'yx' plane for wing feathers — confirming a
 *      near-flat wing panel does not collapse to stripes.
 *  12. Dragon and unicorn geometries are NOT feather-patched.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ShaderLib } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  applyBirdFeatherShader,
  BIRD_FEATHER_CONFIG,
} from './birdFeatherShader';
import { createRealisticBirdGeometries } from './geometry/smallBirdGeometry';
import { createHawkGeometries } from './geometry/hawkGeometry';
import {
  NatureSceneRenderer3D,
  NATURE_CREATURE_SIZES,
} from '../../sceneRenderers/NatureSceneRenderer3D';
import { BoidSpecies } from '../../../sim/Boid';
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
function makeBodyGeo(ySpan = 20, zSpan = 5): THREE.BufferGeometry {
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
const NORMAL_PRED_FLAGS = { isMonster: false, isShark: false };
const MONSTER_PRED_FLAGS = { isMonster: true, isShark: false };

// ---------------------------------------------------------------------------
// Vertex shader injection
// ---------------------------------------------------------------------------

describe('birdFeatherShader vertex injection', () => {
  it('sets the rest-space position varying in the vertex shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vBirdFeatherPos = position');
  });

  it('declares vBirdFeatherPos varying at the top of the vertex shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('varying vec3 vBirdFeatherPos');
  });
});

// ---------------------------------------------------------------------------
// Fragment shader injection
// ---------------------------------------------------------------------------

describe('birdFeatherShader fragment injection', () => {
  it('contains the barb-darkness uniform in the fragment shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uBarbDarkness');
  });

  it('contains the barb-frequency uniform in the fragment shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uBarbFreq');
  });

  it('contains the barb-gloss uniform in the fragment shader', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uBarbGloss');
  });
});

// ---------------------------------------------------------------------------
// GLSL safety: only mutable l-values are written to
// ---------------------------------------------------------------------------

describe('birdFeatherShader writes only to assignable l-values', () => {
  /**
   * REQUIRED TEST — vColor write guard.
   *
   * vColor is a read-only `in` under GLSL 300 ES.  Any assignment to it
   * causes an "l-value required" link error that blacks out the entire
   * nature scene.  This test catches that mistake silently.
   *
   * Routed through the real scene renderer so that a refactor that changes
   * which shader is applied also triggers this guard.
   */
  it('renderer body material never assigns to the read-only vColor input', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getBoidInstanceConfig(BoidSpecies.Gold, NATURE_FLAGS);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchBodyMaterial(mat, geometries);
    const { fragmentShader } = captureShader(mat);

    // Slice to only the injected section so we do not match unrelated uses.
    const injected = fragmentShader.slice(fragmentShader.indexOf('uBarbFreq'));
    expect(injected).not.toMatch(/\bvColor\b\s*(\.[a-z]+)?\s*(=|\*=|\+=|-=|\/=)/);
    expect(injected).toContain('diffuseColor.rgb *=');
  });

  it('applies the pattern after color_fragment so vColor is already folded in', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    const { fragmentShader } = captureShader(mat);

    expect(fragmentShader.indexOf('#include <color_fragment>')).toBeLessThan(
      fragmentShader.indexOf('diffuseColor.rgb *= 1.0 - uBarbDarkness'),
    );
  });
});

// ---------------------------------------------------------------------------
// No-op when barbDarkness is 0
// ---------------------------------------------------------------------------

describe('birdFeatherShader no-op when barbDarkness is 0', () => {
  it('does not set onBeforeCompile when barbDarkness is 0', () => {
    const geo = makeBodyGeo();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    applyBirdFeatherShader(mat, geo, {
      barbsPerLength: 20,
      barbDarkness: 0,
      barbGloss: 0.18,
      featherElongation: 3.2,
      barbRachis: 0.16,
    });
    expect(mat.onBeforeCompile).toBe(originalCompile);
  });
});

// ---------------------------------------------------------------------------
// Frequency and cell-size derivation
// ---------------------------------------------------------------------------

describe('birdFeatherShader frequency and cell-size derivation', () => {
  it('uBarbFreq uniform matches barbsPerLength / zSpan on real small-bird geometry', () => {
    const { body } = createRealisticBirdGeometries(
      NATURE_CREATURE_SIZES.smallBird.length,
      NATURE_CREATURE_SIZES.smallBird.width,
    );
    body.computeBoundingBox();
    const bb = body.boundingBox!;
    const zSpan = bb.max.z - bb.min.z;
    const expectedFreq = BIRD_FEATHER_CONFIG.barbsPerLength / zSpan;

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, body, BIRD_FEATHER_CONFIG, 'yz');
    const { uniforms } = captureShader(mat);

    expect(uniforms.uBarbFreq.value).toBeCloseTo(expectedFreq, 4);
  });

  it('small-bird body feather cell size is in the fine range (0.05–0.50 wu)', () => {
    const { body } = createRealisticBirdGeometries(
      NATURE_CREATURE_SIZES.smallBird.length,
      NATURE_CREATURE_SIZES.smallBird.width,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, body, BIRD_FEATHER_CONFIG, 'yz');
    const { uniforms } = captureShader(mat);

    // Cell size = 1 / freq (world units per barb cell).
    // Birds must be finer than the dragon (≈ 0.80 wu) and in the same
    // ballpark as the finer fishtank fish (goldfish ≈ 0.094, barracuda
    // ≈ 0.113, butterflyfish ≈ 0.448 wu).
    const cellSizeWorld = 1.0 / uniforms.uBarbFreq.value;
    expect(cellSizeWorld).toBeGreaterThan(0.05);
    expect(cellSizeWorld).toBeLessThan(0.50);
  });

  it('hawk body feather cell size is finer than dragon scales (< 0.5 wu)', () => {
    const { body } = createHawkGeometries(
      NATURE_CREATURE_SIZES.hawk.length,
      NATURE_CREATURE_SIZES.hawk.width,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, body, BIRD_FEATHER_CONFIG, 'yz');
    const { uniforms } = captureShader(mat);

    const cellSizeWorld = 1.0 / uniforms.uBarbFreq.value;
    expect(cellSizeWorld).toBeLessThan(0.50);
    expect(cellSizeWorld).toBeGreaterThan(0.05);
  });

  it('uBarbDarkness uniform matches BIRD_FEATHER_CONFIG.barbDarkness', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    const { uniforms } = captureShader(mat);
    expect(uniforms.uBarbDarkness.value).toBeCloseTo(0.22, 4);
  });

  it('uBarbGloss uniform matches BIRD_FEATHER_CONFIG.barbGloss', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    const { uniforms } = captureShader(mat);
    expect(uniforms.uBarbGloss.value).toBeCloseTo(0.18, 4);
  });

  it('wing material uses X span for frequency (yx plane)', () => {
    const { wingLeft } = createRealisticBirdGeometries(
      NATURE_CREATURE_SIZES.smallBird.length,
      NATURE_CREATURE_SIZES.smallBird.width,
    );
    wingLeft.computeBoundingBox();
    const bb = wingLeft.boundingBox!;
    const xSpan = bb.max.x - bb.min.x;
    const expectedFreq = BIRD_FEATHER_CONFIG.barbsPerLength / xSpan;

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, wingLeft, BIRD_FEATHER_CONFIG, 'yx');
    const { uniforms } = captureShader(mat);

    expect(uniforms.uBarbFreq.value).toBeCloseTo(expectedFreq, 4);
  });
});

// ---------------------------------------------------------------------------
// Species routing: patchBodyMaterial applies the feather shader to birds
// ---------------------------------------------------------------------------

describe('NatureSceneRenderer3D.patchBodyMaterial bird feather routing', () => {
  it('patches onBeforeCompile for a goldfinch (Gold boid) via patchBodyMaterial', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getBoidInstanceConfig(BoidSpecies.Gold, NATURE_FLAGS);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    renderer.patchBodyMaterial(mat, geometries);
    expect(mat.onBeforeCompile).not.toBe(originalCompile);
  });

  it('goldfinch compiled fragment shader contains the feather pattern', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getBoidInstanceConfig(BoidSpecies.Gold, NATURE_FLAGS);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchBodyMaterial(mat, geometries);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uBarbDarkness');
    expect(fragmentShader).toContain('uBarbGloss');
  });

  it('patches onBeforeCompile for a hawk (Normal predator) via patchBodyMaterial', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Normal,
      NATURE_FLAGS,
      NORMAL_PRED_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    renderer.patchBodyMaterial(mat, geometries);
    expect(mat.onBeforeCompile).not.toBe(originalCompile);
  });

  it('does NOT patch dragon geometry with the feather shader', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Monster,
      NATURE_FLAGS,
      MONSTER_PRED_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchBodyMaterial(mat, geometries);
    const { fragmentShader } = captureShader(mat);
    // Dragon gets scales, not feathers.
    expect(fragmentShader).not.toContain('uBarbDarkness');
    expect(fragmentShader).not.toContain('uBarbFreq');
    expect(fragmentShader).toContain('uScaleEdgeDarkness');
  });

  it('does NOT patch unicorn geometry with the feather shader', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Horse,
      NATURE_FLAGS,
      NORMAL_PRED_FLAGS,
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchBodyMaterial(mat, geometries);
    const { fragmentShader } = captureShader(mat);
    // The unicorn IS patched — with the mane hair shader (#248) — so asserting
    // "no patch at all" here would be wrong. What matters is that it does not
    // get the BIRD feather pattern.
    expect(fragmentShader).not.toContain('uBarbDarkness');
    expect(fragmentShader).not.toContain('uBarbFreq');
    expect(fragmentShader).toContain('uHairGapDarkness');
  });
});

// ---------------------------------------------------------------------------
// REQUIRED: material.clone() drops the shader patch
// ---------------------------------------------------------------------------

describe('birdFeatherShader clone-first rule', () => {
  /**
   * REQUIRED TEST — clone loses patch.
   *
   * THREE.Material.clone() silently drops both onBeforeCompile and
   * customProgramCacheKey.  The Renderer3D works around this by cloning
   * FIRST (for left/right wings and tail) and then patching each clone
   * independently (#271).  This test confirms the pitfall is real — if
   * clone() ever starts preserving onBeforeCompile the test will fail and
   * the Renderer3D strategy can be revisited.
   *
   * Routed through patchBodyMaterial so a refactor that changes how the
   * patch is applied is immediately detected.
   */
  it('material.clone() drops the feather shader patch (Renderer3D must clone-first)', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getBoidInstanceConfig(BoidSpecies.Gold, NATURE_FLAGS);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const defaultCompile = mat.onBeforeCompile;

    renderer.patchBodyMaterial(mat, geometries);
    expect(mat.onBeforeCompile).not.toBe(defaultCompile);

    // THREE.Material.clone() does NOT copy onBeforeCompile or
    // customProgramCacheKey.  The cloned material is unpatched.
    const cloned = mat.clone();
    expect(cloned.onBeforeCompile).toBe(defaultCompile);
    // The clone's cache key must not contain the feather shader fingerprint —
    // confirming that patching the original did not affect the clone.
    expect(cloned.customProgramCacheKey()).not.toContain('aiboids-bird-feather');
  });
});

// ---------------------------------------------------------------------------
// REQUIRED: cache-key collision between two configs
// ---------------------------------------------------------------------------

describe('birdFeatherShader cache-key uniqueness', () => {
  /**
   * REQUIRED TEST — no cache-key collision.
   *
   * patternPlane MUST be part of the customProgramCacheKey.  three.js reuses
   * a previously compiled program when the key matches, so if body ('yz')
   * and wing ('yx') materials share a key the wing silently gets the body's
   * compiled program and the pattern degenerates to stripes.
   *
   * Routed through patchBodyMaterial and patchWingMaterial so a refactor
   * that omits the plane from the key is immediately detected.
   */
  it('body and wing materials have different cache keys (patternPlane in key)', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getBoidInstanceConfig(BoidSpecies.Gold, NATURE_FLAGS);

    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchBodyMaterial(bodyMat, geometries);
    const bodyKey = bodyMat.customProgramCacheKey();

    const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchWingMaterial(wingMat, geometries);
    const wingKey = wingMat.customProgramCacheKey();

    expect(bodyKey).not.toBe('');
    expect(wingKey).not.toBe('');
    expect(bodyKey).not.toBe(wingKey);
  });
});

// ---------------------------------------------------------------------------
// REQUIRED: pattern plane on wing does not collapse to stripes
// ---------------------------------------------------------------------------

describe('birdFeatherShader wing-panel plane selection', () => {
  /**
   * REQUIRED TEST — no stripe collapse on wing.
   *
   * Bird wings are near-flat panels in XY (tiny Z span).  Using 'yz' on a
   * wing freezes the second coordinate, degenerating the 2D cell pattern
   * into lengthwise stripes.  The renderer must select 'yx' for wings.
   *
   * This test checks the compiled fragment shader reads vBirdFeatherPos.x
   * (the 'yx' plane's second axis) rather than vBirdFeatherPos.z (which
   * would mean 'yz' was incorrectly used).
   *
   * Routed through patchWingMaterial so a change in the renderer's plane
   * selection logic is immediately detected.
   */
  it('renderer uses yx plane for wing feathers (not yz which collapses to stripes)', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getBoidInstanceConfig(BoidSpecies.Gold, NATURE_FLAGS);

    const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchWingMaterial(wingMat, geometries);
    const { fragmentShader } = captureShader(wingMat);

    // With 'yx' plane the injected GLSL reads vBirdFeatherPos.x.
    // Slice to the injected section to avoid matching unrelated declarations.
    const injected = fragmentShader.slice(fragmentShader.indexOf('uBarbFreq'));
    expect(injected).toContain('vBirdFeatherPos.x');
    // vBirdFeatherPos.z would mean 'yz' was used — stripe collapse.
    expect(injected).not.toContain('vBirdFeatherPos.z');
  });

  it('renderer uses yz plane for body feathers (not yx)', () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getBoidInstanceConfig(BoidSpecies.Gold, NATURE_FLAGS);

    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true });
    renderer.patchBodyMaterial(bodyMat, geometries);
    const { fragmentShader } = captureShader(bodyMat);

    const injected = fragmentShader.slice(fragmentShader.indexOf('uBarbFreq'));
    expect(injected).toContain('vBirdFeatherPos.z');
    expect(injected).not.toContain('vBirdFeatherPos.x');
  });
});

// ---------------------------------------------------------------------------
// Uniforms drive the output (not just declared)
// ---------------------------------------------------------------------------

describe('birdFeatherShader uniforms drive the shipped output', () => {
  const outputStatements = (fragmentShader: string): string[] => {
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
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    const { fragmentShader } = captureShader(mat);

    const statements = outputStatements(fragmentShader);
    expect(statements.length, 'expected statements writing diffuseColor/roughnessFactor').toBeGreaterThan(0);

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
      `${uniform} is declared but never reaches diffuseColor or roughnessFactor`,
    ).toBe(true);
  };

  it('uBarbDarkness affects the rendered output', () => {
    assertDrivesOutput('uBarbDarkness');
  });

  it('uBarbGloss affects the rendered output', () => {
    assertDrivesOutput('uBarbGloss');
  });
});

// ---------------------------------------------------------------------------
// Composition: feather shader chains with a mock prior patch in either order
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

describe('birdFeatherShader composition — feather then mock prior', () => {
  it('vertex shader contains the bird feather position injection', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    applyMockPriorPatch(mat);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vBirdFeatherPos = position');
  });

  it('vertex shader still contains the mock prior sentinel', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    applyMockPriorPatch(mat);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('__MOCK_PRIOR_SENTINEL__');
  });
});

describe('birdFeatherShader composition — mock prior then feather', () => {
  it('vertex shader contains the bird feather position injection', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyMockPriorPatch(mat);
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vBirdFeatherPos = position');
  });

  it('vertex shader still contains the mock prior sentinel', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyMockPriorPatch(mat);
    applyBirdFeatherShader(mat, makeBodyGeo(), BIRD_FEATHER_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('__MOCK_PRIOR_SENTINEL__');
  });
});
