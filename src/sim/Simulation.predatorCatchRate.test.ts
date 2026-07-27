import { describe, it, expect, afterEach } from 'vitest';
import { Simulation } from './Simulation';
import { params, resetParams } from './params';
import type { VisualStyle } from './params';
import { getPredatorCatchProfilesForStyle } from '../render/sceneRenderers/predatorCatchProfiles';

/**
 * Behavioural regression guard for predator catch rate (#237).
 *
 * #221/#228 shrank the catch sphere by roughly 5x in radius and cut the catch
 * rate by up to 20x, and the entire unit suite stayed green — nothing anywhere
 * asserted that predators actually catch anything. This test exists to make
 * that class of change impossible to land silently.
 *
 * It is deliberately a *floor*, not a target: the point is to detect
 * predation collapsing, not to pin a difficulty level. The floor is anchored
 * absolutely (an integer count of catches), never as a multiple of the bite
 * radius under test, so retuning that radius cannot make the bound move with
 * it.
 */

const REAL_RANDOM = Math.random;

/** Deterministic LCG so the counts below are reproducible across machines. */
function seedRandom(seed: number): void {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function countCatches(style: VisualStyle, seconds: number, seed: number): number {
  seedRandom(seed);
  resetParams();
  params.mode = '3d';
  params.visualStyle = style;
  params.boidCount = 60;
  params.predatorCount = 3;
  params.monsterCount = 1;
  params.horseCount = 0;
  params.multicolorCount = 0;
  params.goldCount = 0;
  params.redCount = 0;
  params.blueCount = 0;

  const sim = new Simulation(1000, 1000);
  sim.setPredatorCatchProfiles(getPredatorCatchProfilesForStyle(style));

  const caught = new Set<number>();
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.update(1 / 60);
    for (const boid of sim.boids) if (boid.dying) caught.add(boid.id);
  }
  return caught.size;
}

describe('predator catch rate does not collapse', () => {
  afterEach(() => {
    Math.random = REAL_RANDOM;
    resetParams();
  });

  // Measured over 6 seeds x 40 s, shipped bite radius vs the pre-#237 one:
  //
  //   scene     | shipped | pre-#237
  //   arcade    |      21 |        2
  //   nature    |      19 |       10
  //   fishtank  |      22 |        8
  //
  // A floor of 14 sits clear of both: at least 5 catches below every shipped
  // count and at least 4 above every regressed one. Widen the sample rather
  // than lowering this bound if it ever proves marginal.
  const MIN_CATCHES = 14;

  for (const style of ['arcade', 'nature', 'fishtank'] as const) {
    it(
      `${style}: predators catch prey over a 240 s sample`,
      () => {
        let total = 0;
        for (const seed of [1, 2, 3, 4, 5, 6]) total += countCatches(style, 40, seed);
        expect(total).toBeGreaterThanOrEqual(MIN_CATCHES);
      },
      60_000,
    );
  }
});
