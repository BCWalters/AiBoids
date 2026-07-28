/**
 * Behavioural regression guard for hawk orientation (#255).
 *
 * Root cause: hawks had no `preferUpright` flag in their MotionConfig, so
 * CreatureInstanceRenderer fell back to `setFromUnitVectors(FORWARD_AXIS, heading)`.
 * That produces the minimal rotation from +Y to the heading direction, which does
 * NOT preserve world-up alignment for arbitrary horizontal headings — the hawk's
 * dorsal could point sideways or downward for any non-Y heading. Measured rate
 * (6 seeds × 30 s, same LCG as predatorCatchRate.test.ts): ~42% of frames inverted.
 *
 * Fix: `preferUpright: true` in the hawk MotionConfig switches the renderer to
 * `setPersistedUprightBasis`, which anchors the dorsal to world-up via an explicit
 * cross-product basis. Post-fix rate: 0%.
 *
 * Threshold chosen to sit squarely between both measured populations:
 *   broken ~42%  |  THRESHOLD = 5%  |  fixed 0%
 *
 * Falsification: removing `preferUpright: true` from NatureSceneRenderer3D's hawk
 * MotionConfig restores the 42% rate and fails this test immediately.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../../sim/Simulation';
import { params, resetParams } from '../../sim/params';
import type { Predator } from '../../sim/Predator';
import { CreatureInstanceRenderer, type BoidRenderBatch } from '../CreatureInstanceRenderer';
import type { ColorStrategy } from './createSceneRendererHooks';
import { getPredatorCatchProfilesForStyle } from './predatorCatchProfiles';
import { PredatorSpecies } from './createSceneRendererHooks';
import { NatureSceneRenderer3D } from './NatureSceneRenderer3D';

// ---------------------------------------------------------------------------
// Seeded PRNG — same LCG as Simulation.predatorCatchRate.test.ts
// ---------------------------------------------------------------------------

const REAL_RANDOM = Math.random;

function seedRandom(seed: number): void {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Minimal Three.js render infrastructure
// ---------------------------------------------------------------------------

const FLAT_COLORS: ColorStrategy = {
  baseColor: new THREE.Color(0xffffff),
  highlightColor: new THREE.Color(0xffffff),
  getIntensity: () => 0,
  colorMode: 'flat',
};

function createMesh(count: number): THREE.InstancedMesh {
  return new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    count,
  );
}

function createBatch(count: number): BoidRenderBatch {
  return { body: createMesh(count), wingLeft: createMesh(count), wingRight: createMesh(count) };
}

/**
 * Returns true when the hawk's dorsal (model +Z, world-space Z-column of the
 * body matrix) is pointing downward (world-Y < 0), i.e. the creature is
 * rendered upside-down.
 *
 * In Three.js column-major storage, elements[8..10] are the Z-column
 * (model +Z in world space). Element [9] is the world-Y component.
 */
function isDorsalInverted(bodyMesh: THREE.InstancedMesh, index: number): boolean {
  const m = new THREE.Matrix4();
  bodyMesh.getMatrixAt(index, m);
  return m.elements[9] < 0;
}

/**
 * Runs the simulation for `seconds` at 60 fps, calling updateInstances each
 * frame, and returns the fraction of creature-frames where the dorsal is
 * pointing downward. `creatures` must be live references from `sim.predators`.
 */
function measureInversionFraction(sim: Simulation, hawks: Predator[], seconds: number): number {
  const hawkMotion = NatureSceneRenderer3D.prototype.getPredatorMotionConfig.call(
    {} as NatureSceneRenderer3D,
    PredatorSpecies.Normal,
    {} as never,
  );

  const renderer = new CreatureInstanceRenderer(new THREE.Vector3());
  const set = createBatch(hawks.length);
  const MAX_SPEED = 15;
  const steps = Math.round(seconds * 60);
  let inverted = 0;
  let total = 0;

  for (let i = 0; i < steps; i++) {
    sim.update(1 / 60);
    renderer.updateInstances(set, hawks, MAX_SPEED, i / 60, 1 / 60, FLAT_COLORS, hawkMotion);
    for (let j = 0; j < hawks.length; j++) {
      if (isDorsalInverted(set.body, j)) inverted++;
      total++;
    }
  }

  return total > 0 ? inverted / total : 0;
}

// ---------------------------------------------------------------------------
// Threshold
// ---------------------------------------------------------------------------

/**
 * Broken code (no preferUpright) → ~42% inverted.
 * Fixed code (preferUpright: true) → 0% inverted.
 * 5% sits squarely between both measured populations and is well above
 * any rounding noise in the 0% fixed rate.
 */
const MAX_INVERTED_FRACTION = 0.05;

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('hawk inverted-frame fraction stays well below 5%', () => {
  afterEach(() => {
    Math.random = REAL_RANDOM;
    resetParams();
  });

  it(
    'hawk dorsal rarely points downward across 6 seeds × 30 s',
    () => {
      let totalFraction = 0;
      let runs = 0;

      for (const seed of [1, 2, 3, 4, 5, 6]) {
        seedRandom(seed);
        resetParams();
        params.mode = '3d';
        params.visualStyle = 'nature';
        params.boidCount = 30;
        params.predatorCount = 3;
        params.monsterCount = 0;
        params.horseCount = 0;
        params.multicolorCount = 0;
        params.goldCount = 0;
        params.redCount = 0;
        params.blueCount = 0;

        const sim = new Simulation(1000, 1000);
        sim.setPredatorCatchProfiles(getPredatorCatchProfilesForStyle('nature'));

        const hawks = sim.predators.filter(p => p.species === PredatorSpecies.Normal);
        if (hawks.length > 0) {
          totalFraction += measureInversionFraction(sim, hawks, 30);
          runs++;
        }
      }

      const avgFraction = runs > 0 ? totalFraction / runs : 0;
      expect(avgFraction).toBeLessThan(MAX_INVERTED_FRACTION);
    },
    60_000,
  );
});
