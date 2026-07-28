import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Simulation } from './Simulation';
import { params, defaultParams } from './params';
import { nearWallAxisCount, type WorldBounds } from './boundary';

/**
 * Regression guard for #253 — predators pinning themselves against the world
 * boundary instead of hunting in open water.
 *
 * ## Why this test is shaped the way it is
 *
 * Measuring hunting geometry with `predatorCatchEnabled = true` is circular:
 * anything that gets close enough to a wall-pinned boid immediately catches it
 * and leaves the sample, so the statistic measures the gape rather than the
 * steering. Catches are therefore disabled here.
 *
 * The threshold is anchored **between two measured populations**, not chosen as
 * a round number:
 *
 * | population                     | predator wall-layer occupancy |
 * |--------------------------------|-------------------------------|
 * | broken (open-water preference removed) | 41.7 %                |
 * | fixed (shipped)                | 15.7 %                        |
 * | prey control (both)            | ~15–16 %                      |
 *
 * 28 % sits roughly midway, leaving ~12 pp of margin on each side. A bound that
 * cannot bind is not a test — this one was falsified by reverting the
 * production change, which produces ~42 % and fails.
 *
 * The prey control matters as much as the predator number: it confirms the fix
 * is specific to predator steering rather than a global boundary change that
 * simply pushed everything inward.
 */

const WORLD_WIDTH = 1200;
const WORLD_HEIGHT = 800;

/** Deterministic LCG — raw runs vary enough that unseeded numbers are noise. */
function seedRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Occupancy {
  predator: number;
  prey: number;
}

function measureWallOccupancy(seed: number, seconds: number): Occupancy {
  const originalRandom = Math.random;
  Math.random = seedRandom(seed);
  try {
    params.mode = '3d';
    params.predatorCatchEnabled = false;
    const sim = new Simulation(WORLD_WIDTH, WORLD_HEIGHT);
    sim.reset();
    const bounds: WorldBounds = {
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      depth: params.worldDepth,
    };

    let predatorNear = 0;
    let predatorTotal = 0;
    let preyNear = 0;
    let preyTotal = 0;

    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      sim.update(1 / 60);
      for (const predator of sim.predators) {
        predatorTotal++;
        if (nearWallAxisCount(predator.position, bounds, params.boundaryMargin) > 0) predatorNear++;
      }
      for (const boid of sim.boids) {
        preyTotal++;
        if (nearWallAxisCount(boid.position, bounds, params.boundaryMargin) > 0) preyNear++;
      }
    }

    return { predator: predatorNear / predatorTotal, prey: preyNear / preyTotal };
  } finally {
    Math.random = originalRandom;
  }
}

describe('predator wall binding (#253)', () => {
  beforeEach(() => {
    Object.assign(params, defaultParams);
  });
  afterEach(() => {
    Object.assign(params, defaultParams);
  });

  it(
    'keeps predators out of the boundary layer, near the prey control rate',
    { timeout: 240_000 },
    () => {
      const runs = [1, 2].map((seed) => measureWallOccupancy(seed, 30));
      const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
      const predator = mean(runs.map((r) => r.predator));
      const prey = mean(runs.map((r) => r.prey));

      expect(
        predator,
        `predator wall-layer occupancy ${(predator * 100).toFixed(1)}% exceeds the 28% ` +
          `threshold (broken baseline 41.7%, fixed baseline 15.7%). The open-water ` +
          `target preference in Predator.update -- 'pursued = predatorNearWall ? ` +
          `nearestOpenWater : nearest' -- is the code path this guards.`,
      ).toBeLessThan(0.28);

      // Control: prey are not wall-bound and must not have been pushed around
      // by this change. If this drifts, the predator number above is measuring
      // a global boundary change rather than predator steering.
      expect(prey).toBeLessThan(0.28);
    },
  );
});
