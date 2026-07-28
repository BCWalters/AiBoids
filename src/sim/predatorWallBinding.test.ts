import { afterEach, describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';
import { params, resetParams } from './params';
import { nearWallAxisCount, type WorldBounds } from './boundary';

/**
 * Behavioural regression guard for predator wall-binding (#253).
 *
 * Root cause: pursuit force (~250 units) overwhelms position-based boundary
 * push (~87.5 units), creating a stable co-pinning equilibrium — predator
 * drives prey to a wall and chases it there indefinitely.  The fix (see
 * Predator.ts) uses cornerStuckTime-based hysteresis to prefer open-water
 * prey targets and falls back to the world centre when no open-water boid is
 * in perception range, breaking the co-pinning cycle.
 *
 * Measurement protocol (predatorCatchEnabled = false to avoid the circular-
 * measurement trap documented in the issue — catches remove prey from the
 * sample and bias minimum approach toward gape size):
 *
 *   BROKEN (before fix):  aggregate predator wall-layer occupancy = 42.1 %
 *   FIXED  (after  fix):  aggregate predator wall-layer occupancy = 20.9 %
 *   THRESHOLD:            31.5 % (midpoint)
 *
 * To falsify: revert the cornerStuckTime condition in Predator.ts back to
 * `nearWallAxisCount(this.position, bounds, p.boundaryMargin) > 0` and drop
 * the world-centre fallback.  The test reports the measured occupancy on
 * failure, so the regression message itself documents the broken vs fixed
 * populations.
 *
 * Timeout: 120 000 ms explicit third arg so this test is not killed by
 * vitest's 5 000 ms default even when --testTimeout=1000 is passed globally.
 */

const REAL_RANDOM = Math.random;

/** Deterministic LCG — same generator as Simulation.predatorCatchRate.test.ts. */
function seedRandom(seed: number): void {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function measureWallOccupancy(seed: number, seconds: number): number {
  seedRandom(seed);
  resetParams();
  params.mode = '3d';
  params.boidCount = 60;
  params.predatorCount = 3;
  params.monsterCount = 1;
  params.horseCount = 0;
  params.multicolorCount = 0;
  params.goldCount = 0;
  params.redCount = 0;
  params.blueCount = 0;
  // Must be false: catches remove prey, making measured minimum approach ≈
  // gape by construction and hiding the co-pinning symptom.
  params.predatorCatchEnabled = false;

  const W = 1000;
  const H = 1000;
  const sim = new Simulation(W, H);
  const bounds: WorldBounds = { width: W, height: H, depth: params.worldDepth };
  const m = params.boundaryMargin;

  let wallFrames = 0;
  let totalFrames = 0;
  const dt = 1 / 60;
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.update(dt);
    for (const predator of sim.predators) {
      totalFrames++;
      if (nearWallAxisCount(predator.position, bounds, m) > 0) wallFrames++;
    }
  }
  return wallFrames / totalFrames;
}

describe('predator wall-binding regression (#253)', () => {
  afterEach(() => {
    Math.random = REAL_RANDOM;
    resetParams();
  });

  it(
    'predator wall-layer occupancy stays below 31.5 % (midpoint of broken=42.1 % and fixed=20.9 %)',
    () => {
      // 4 seeds × 40 s — mirrors the catch-rate test cadence; aggregate is
      // stable because the fix reduces occupancy by ~21 pp with <3 pp per-seed
      // variance (see probe results in the PR description).
      const seconds = 40;
      let total = 0;
      for (const seed of [1, 2, 3, 4]) {
        total += measureWallOccupancy(seed, seconds);
      }
      const aggregateOccupancy = total / 4;

      // Threshold is the midpoint between the broken population (42.1%) and
      // the fixed population (20.9%), giving 10.6 pp of margin on each side.
      const THRESHOLD = 0.315;
      expect(
        aggregateOccupancy,
        `Predator wall-layer occupancy ${(aggregateOccupancy * 100).toFixed(1)}% ` +
          `exceeds threshold ${(THRESHOLD * 100).toFixed(1)}%. ` +
          `Broken baseline: 42.1%, fixed baseline: 20.9%. ` +
          `Check cornerStuckTime open-water preference in Predator.ts.`,
      ).toBeLessThan(THRESHOLD);
    },
    120_000,
  );
});
