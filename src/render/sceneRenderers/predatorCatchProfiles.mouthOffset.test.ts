import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PredatorSpecies } from '../../sim/Predator';
import {
  ARCADE_PREDATOR_CATCH_PROFILES,
  FISHTANK_PREDATOR_CATCH_PROFILES,
  NATURE_PREDATOR_CATCH_PROFILES,
} from './predatorCatchProfiles';
import { ARCADE_CREATURE_SIZES } from './ArcadeSceneRenderer3D';
import { FISHTANK_CREATURE_SIZES } from './FishtankSceneRenderer3D';
import { NATURE_CREATURE_SIZES } from './NatureSceneRenderer3D';
import { createBirdGeometries } from '../styles/nature/geometry/smallBirdGeometry';
import { createHawkGeometries } from '../styles/nature/geometry/hawkGeometry';
import { createDragonGeometries } from '../styles/nature/geometry/dragonGeometry';
import { createSharkGeometries } from '../styles/fishtank/geometry/sharkGeometry';
import { createBarracudaGeometries } from '../styles/fishtank/geometry/barracudaGeometry';

/**
 * `mouthOffsetFraction` is a hand-recorded measurement of where each predator's
 * snout sits in its own authored geometry. Nothing in the build re-derives it,
 * so if the geometry is later reshaped the constant silently stops describing
 * the model and catches drift away from the mouth — the exact failure mode
 * issue #221 was about, just relocated.
 *
 * These tests re-measure the geometry and hold the shipped constants to it.
 * They are the only thing standing between "measured" and "was measured once".
 */

/**
 * Forward-most vertex of the head-bearing parts, in model space (creatures
 * face +Y).
 *
 * Deliberately body + beak only. A naive max over *every* part measures the
 * dragon's swept wing leading edge at 0.685 body-lengths rather than its snout
 * at 0.533 — the wings reach further forward than the head does. Legs and tail
 * are likewise never the mouth.
 */
function measureSnoutY(geometries: { body?: THREE.BufferGeometry; beak?: THREE.BufferGeometry }): number {
  let maxY = -Infinity;
  for (const geometry of [geometries.body, geometries.beak]) {
    if (!geometry) continue;
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    if (boundingBox) maxY = Math.max(maxY, boundingBox.max.y);
  }
  return maxY;
}

const CASES = [
  {
    name: 'shark',
    build: () => createSharkGeometries(FISHTANK_CREATURE_SIZES.shark.length, FISHTANK_CREATURE_SIZES.shark.width),
    size: FISHTANK_CREATURE_SIZES.shark,
    profile: FISHTANK_PREDATOR_CATCH_PROFILES[PredatorSpecies.Monster]!,
  },
  {
    name: 'barracuda',
    build: () => createBarracudaGeometries(FISHTANK_CREATURE_SIZES.barracuda.length, FISHTANK_CREATURE_SIZES.barracuda.width),
    size: FISHTANK_CREATURE_SIZES.barracuda,
    profile: FISHTANK_PREDATOR_CATCH_PROFILES[PredatorSpecies.Normal]!,
  },
  {
    name: 'hawk',
    build: () => createHawkGeometries(NATURE_CREATURE_SIZES.hawk.length, NATURE_CREATURE_SIZES.hawk.width),
    size: NATURE_CREATURE_SIZES.hawk,
    profile: NATURE_PREDATOR_CATCH_PROFILES[PredatorSpecies.Normal]!,
  },
  {
    name: 'dragon',
    build: () => createDragonGeometries(NATURE_CREATURE_SIZES.dragon.length, NATURE_CREATURE_SIZES.dragon.width),
    size: NATURE_CREATURE_SIZES.dragon,
    profile: NATURE_PREDATOR_CATCH_PROFILES[PredatorSpecies.Monster]!,
  },
  {
    name: 'arcade predator',
    build: () => createBirdGeometries(ARCADE_CREATURE_SIZES.predator.length, ARCADE_CREATURE_SIZES.predator.width),
    size: ARCADE_CREATURE_SIZES.predator,
    profile: ARCADE_PREDATOR_CATCH_PROFILES[PredatorSpecies.Normal]!,
  },
] as const;

describe('predator catch profiles match the authored geometry', () => {
  for (const testCase of CASES) {
    it(`${testCase.name} mouthOffsetFraction matches its measured snout`, () => {
      const measured = measureSnoutY(testCase.build()) / testCase.size.length;
      // toBeCloseTo(_, 2) allows 0.005 of a body length: loose enough for
      // spline resampling and part merges, tight enough that the 0.5
      // placeholder the arcade profile originally carried (measured: 1.000)
      // fails, and that a 0.08 drift on the hawk fails.
      expect(measured).toBeCloseTo(testCase.profile.mouthOffsetFraction, 2);
    });
  }
});
