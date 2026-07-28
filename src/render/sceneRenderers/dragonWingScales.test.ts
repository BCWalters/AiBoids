import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { NatureSceneRenderer3D } from './NatureSceneRenderer3D';
import type { DriftingClouds } from '../styles/nature/clouds';
import type { FireBreathEffects } from '../styles/nature/fireBreath';
import { PredatorSpecies } from './createSceneRendererHooks';

/**
 * The dragon's scale pattern must reach the membrane wings, sampled in the
 * WINGS' own plane.
 *
 * The pattern is 2D and both of its axes must actually vary across the surface.
 * Y (the spine axis) always does, so the second axis is what matters. Measured
 * at LENGTH=2 WIDTH=0.8:
 *
 *   body  X 0.849  Y 1.765  Z 0.672
 *   wing  X 2.796  Y 2.527  Z 0.138   <- 42% of vertices at exactly Z = 0
 *
 * Sampling the wing on the body's YZ plane freezes the second coordinate and
 * the cells degenerate into parallel bands running out along the span. This is
 * not a rotated pattern, it is a destroyed one — and it produces no error.
 *
 * These tests deliberately route through NatureSceneRenderer3D rather than
 * calling applyDragonScaleShader directly. An earlier version called the
 * helper directly with an explicit plane and was therefore blind to the only
 * thing that can realistically regress: which plane the scene renderer passes.
 * Reverting the wing to the body's plane left that version fully green.
 */
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

/** Runs a patched material's injection and returns the generated GLSL. */
function compiledFragment(material: THREE.MeshStandardMaterial): string {
  const shader = {
    vertexShader: '#include <color_vertex>',
    fragmentShader: '#include <roughnessmap_fragment>',
    uniforms: {} as Record<string, THREE.IUniform>,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  return shader.fragmentShader;
}

function patternExpr(fragment: string): string {
  return fragment.match(/vec2 sp = vec2\([^)]*\)/)?.[0] ?? '';
}

describe('dragon wing scales', () => {
  // The renderer routes on geometry IDENTITY (geometries === its own dragon
  // geometries), so the renderer under test must be the same one the
  // geometries came from.
  const dragonSetup = () => {
    const renderer = makeNatureRenderer();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Monster,
      NATURE_FLAGS,
      MONSTER_PRED_FLAGS,
    );
    return { renderer, geometries };
  };

  it('samples the wings on X and the body on Z', () => {
    const { renderer, geometries } = dragonSetup();

    const wingMat = new THREE.MeshStandardMaterial();
    renderer.patchWingMaterial!(wingMat, geometries);
    const wing = patternExpr(compiledFragment(wingMat));

    const bodyMat = new THREE.MeshStandardMaterial();
    renderer.patchBodyMaterial!(bodyMat, geometries);
    const body = patternExpr(compiledFragment(bodyMat));

    // The wing's second axis must be X; Z is near-constant across the membrane
    // and collapses the cells into stripes.
    expect(wing).toContain('vDragonScalePos.x');
    expect(wing).not.toContain('vDragonScalePos.z');
    // The body keeps its dorsoventral Z, so this isn't a global swap.
    expect(body).toContain('vDragonScalePos.z');
  });

  it('gives wing and body different program cache keys', () => {
    const { renderer, geometries } = dragonSetup();

    const wingMat = new THREE.MeshStandardMaterial();
    const bodyMat = new THREE.MeshStandardMaterial();
    renderer.patchWingMaterial!(wingMat, geometries);
    renderer.patchBodyMaterial!(bodyMat, geometries);

    // three.js reuses a compiled program whenever the cache key matches. If the
    // plane is left out of the key the wing silently renders with the body's
    // program, so the assertions above pass while the runtime shows stripes.
    expect(wingMat.customProgramCacheKey!()).not.toBe(bodyMat.customProgramCacheKey!());
  });

  it('is lost by Material.clone(), so both wings must be patched after cloning', () => {
    const { renderer, geometries } = dragonSetup();
    const original = new THREE.MeshStandardMaterial();
    renderer.patchWingMaterial!(original, geometries);
    const cloned = original.clone();

    expect(original.customProgramCacheKey!()).toContain('aiboids-dragon-scale');
    // Pinned so nobody "simplifies" Renderer3D back to patch-then-clone, which
    // would leave the right wing bare.
    expect(cloned.customProgramCacheKey?.() ?? '').not.toContain('aiboids-dragon-scale');
  });
});
