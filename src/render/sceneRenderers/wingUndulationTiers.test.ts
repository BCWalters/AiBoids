import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { NatureSceneRenderer3D } from './NatureSceneRenderer3D';
import type { DriftingClouds } from '../styles/nature/clouds';
import type { FireBreathEffects } from '../styles/nature/fireBreath';
import { PredatorSpecies } from './createSceneRendererHooks';
import { BoidSpecies } from '../../sim/Boid';

/**
 * How much the wing undulation moves is NOT one number for the whole scene.
 * The exaggerated slap that suits a big, slow, showy wing reads as wrong on a
 * sparrow, whose real wingbeat is a fast blur with very little visible flex.
 * So small birds and the hawk stay on the standard motion while the parrot,
 * dragon and unicorn get a moderate one.
 *
 * These tests deliberately route through NatureSceneRenderer3D rather than
 * reading the config constants directly. The constants are trivially correct;
 * the only thing that can realistically regress is the DISPATCH — which
 * creature is handed which config. A test that asserted on the constants would
 * stay green through every mis-wiring this file exists to catch.
 *
 * The assertions read the amplitude back out of the material's
 * customProgramCacheKey, which is the same string three.js uses to decide
 * whether two materials can share a compiled program. That makes these tests
 * double as a check that creatures on different motion cannot collide in the
 * program cache.
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

function wingMesh(): THREE.InstancedMesh {
  // A panel with real spanwise extent, so measureSpanwiseExtent finds a span
  // and the amplitude does not collapse to zero.
  return new THREE.InstancedMesh(
    new THREE.BoxGeometry(2, 0.4, 0.02),
    new THREE.MeshStandardMaterial(),
    4,
  );
}

/**
 * The undulation cache key is
 * `aiboids-wing-undulation-v3:root:span:amplitude:waveNumber:sharpness`.
 *
 * `amplitude` there is already multiplied by the measured span, so it is
 * divided back out to recover the configured fraction. Doing that rather than
 * assuming the mesh's span is what caught a bug in an earlier version of this
 * file: the panel is built 2 wide but straddles the origin, so both wings
 * measure a span of 1, and a hardcoded 2 made the ceiling assertion below twice
 * as loose as intended — it passed with the full slap wired back in.
 */
function undulationKey(renderer: NatureSceneRenderer3D, geometries: Parameters<
  NonNullable<NatureSceneRenderer3D['setupWingUndulation']>
>[2]): { amplitudeFraction: number; waveNumber: number; sharpness: number } {
  const left = wingMesh();
  const right = wingMesh();
  renderer.setupWingUndulation!(left, right, geometries);
  const key = (left.material as THREE.MeshStandardMaterial).customProgramCacheKey!();
  const parts = key.split('aiboids-wing-undulation-v3:')[1].split(':');
  const span = Number(parts[1]);
  expect(span).toBeGreaterThan(0);
  return {
    amplitudeFraction: Number(parts[2]) / span,
    waveNumber: Number(parts[3]),
    sharpness: Number(parts[4]),
  };
}

function smallBird(renderer: NatureSceneRenderer3D) {
  return renderer.getBoidInstanceConfig(BoidSpecies.Normal, NATURE_FLAGS).geometries;
}

function hawk(renderer: NatureSceneRenderer3D) {
  return renderer.getPredatorInstanceConfig(PredatorSpecies.Normal, NATURE_FLAGS, {
    isMonster: false,
    isShark: false,
  }).geometries;
}

function dragon(renderer: NatureSceneRenderer3D) {
  return renderer.getPredatorInstanceConfig(PredatorSpecies.Monster, NATURE_FLAGS, {
    isMonster: true,
    isShark: false,
  }).geometries;
}

function unicorn(renderer: NatureSceneRenderer3D) {
  return renderer.getPredatorInstanceConfig(PredatorSpecies.Horse, NATURE_FLAGS, {
    isMonster: false,
    isShark: false,
  }).geometries;
}

function parrot(renderer: NatureSceneRenderer3D) {
  const profile = renderer.getParrotProfileNames!(NATURE_FLAGS)[0];
  return renderer.getParrotProfileInstanceConfig!(profile, NATURE_FLAGS).geometries;
}

describe('wing undulation is tiered per creature family', () => {
  it('small birds and the hawk share the standard motion', () => {
    const renderer = makeNatureRenderer();
    const bird = undulationKey(renderer, smallBird(renderer));
    const raptor = undulationKey(renderer, hawk(renderer));
    expect(raptor).toEqual(bird);
    // The standard tier is a plain sine — no wave sharpening at all.
    expect(bird.sharpness).toBe(0);
  });

  it('the parrot, dragon and unicorn share the moderate motion', () => {
    const renderer = makeNatureRenderer();
    const moderate = undulationKey(renderer, parrot(renderer));
    expect(undulationKey(renderer, dragon(renderer))).toEqual(moderate);
    expect(undulationKey(renderer, unicorn(renderer))).toEqual(moderate);
  });

  it('the moderate tier moves more than the standard one, on every axis', () => {
    // Not just "different": bigger amplitude, shorter lag (so the tip is less
    // anti-phase with the shoulder and the stroke rolls outward rather than
    // writhing in an S), and a squared-up wave. Swapping the two tiers would
    // leave an equality-only test green.
    const renderer = makeNatureRenderer();
    const standard = undulationKey(renderer, smallBird(renderer));
    const moderate = undulationKey(renderer, parrot(renderer));
    expect(moderate.amplitudeFraction).toBeGreaterThan(standard.amplitudeFraction);
    expect(moderate.waveNumber).toBeLessThan(standard.waveNumber);
    expect(moderate.sharpness).toBeGreaterThan(standard.sharpness);
  });

  it('the moderate tier stays well short of the full slap that was rejected', () => {
    // The slap was 0.34 of span / 0.7π / sharpness 2 and read as too much. This
    // pins the moderate tier as roughly halfway rather than creeping back up.
    const renderer = makeNatureRenderer();
    const { amplitudeFraction, waveNumber, sharpness } = undulationKey(renderer, parrot(renderer));
    expect(amplitudeFraction).toBeLessThan(0.3);
    expect(waveNumber).toBeGreaterThan(Math.PI * 0.75);
    expect(sharpness).toBeLessThan(2);
  });

  it('creatures on different motion get different program cache keys', () => {
    // Two materials sharing a cache key share a compiled program, so a
    // collision here would silently give one family the other's motion.
    const renderer = makeNatureRenderer();
    const bird = wingMesh();
    const parrotWing = wingMesh();
    renderer.setupWingUndulation!(bird, wingMesh(), smallBird(renderer));
    renderer.setupWingUndulation!(parrotWing, wingMesh(), parrot(renderer));
    expect((bird.material as THREE.MeshStandardMaterial).customProgramCacheKey!()).not.toBe(
      (parrotWing.material as THREE.MeshStandardMaterial).customProgramCacheKey!(),
    );
  });
});
