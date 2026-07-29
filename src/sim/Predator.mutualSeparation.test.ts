import { describe, it, expect, afterEach } from 'vitest';
import { Simulation } from './Simulation';
import { mutualSeparationRadius } from './Predator';
import { params, resetParams } from './params';
import { getPredatorCatchProfilesForStyle } from '../render/sceneRenderers/predatorCatchProfiles';

/**
 * Predators keep apart in proportion to how big they are drawn (#307).
 *
 * The mutual separation rule was originally a flat 60-unit anti-stacking
 * floor, chosen without reference to creature size. The nature dragon is 45
 * units long with a 67.5-unit wingspan, so two dragons obeying that rule
 * perfectly were still drawn intersecting — the reported symptom was a pile of
 * wings and tails radiating from what looked like one body.
 *
 * The simulation has no inherent notion of physical size; it learns body
 * lengths from the active scene's predator catch profiles, which is the same
 * channel the bite radius already uses.
 */

const REAL_RANDOM = Math.random;

function seedRandom(seed: number): void {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const NATURE_DRAGON_LENGTH = 45;
const NATURE_DRAGON_WINGSPAN = NATURE_DRAGON_LENGTH * 1.5;
const NATURE_HAWK_LENGTH = 15.6;

/** Closest approach between any two dragons over a run, in world units. */
function closestDragonApproach({ seed, seconds }: { seed: number; seconds: number }): number {
  seedRandom(seed);
  resetParams();
  params.mode = '3d';
  params.visualStyle = 'nature';

  const sim = new Simulation(1000, 1000);
  sim.setPredatorCatchProfiles(getPredatorCatchProfilesForStyle('nature'));

  let closest = Infinity;
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.update(1 / 60);
    if (i % 5 !== 0) continue;
    const dragons = sim.predators.filter((p) => p.species === 'monster');
    for (let a = 0; a < dragons.length; a++) {
      for (let b = a + 1; b < dragons.length; b++) {
        const dx = dragons[a].position.x - dragons[b].position.x;
        const dy = dragons[a].position.y - dragons[b].position.y;
        const dz = dragons[a].position.z - dragons[b].position.z;
        closest = Math.min(closest, Math.hypot(dx, dy, dz));
      }
    }
  }
  return closest;
}

afterEach(() => {
  Math.random = REAL_RANDOM;
  resetParams();
});

describe('predator mutual separation scales with body size', () => {
  it('gives two dragons more room than their wingspan', () => {
    // The point of the change: correct spacing must not still be a visual
    // collision. Anything at or under the wingspan reproduces #307 exactly.
    expect(mutualSeparationRadius(NATURE_DRAGON_LENGTH, NATURE_DRAGON_LENGTH)).toBeGreaterThan(
      NATURE_DRAGON_WINGSPAN,
    );
  });

  it('leaves the small predators on the original floor', () => {
    // Hawks want only ~28 units by the size rule. Dropping them to that would
    // re-space a population that was never the problem, so the flat floor
    // still governs anything small — this widens the big creatures only.
    expect(mutualSeparationRadius(NATURE_HAWK_LENGTH, NATURE_HAWK_LENGTH)).toBe(60);
  });

  it('takes body length from the scene catch profiles rather than guessing', () => {
    resetParams();
    params.mode = '3d';
    params.visualStyle = 'nature';
    const sim = new Simulation(1000, 1000);
    sim.setPredatorCatchProfiles(getPredatorCatchProfilesForStyle('nature'));

    const dragon = sim.predators.find((p) => p.species === 'monster');
    const unicorn = sim.predators.find((p) => p.species === 'horse');
    expect(dragon?.bodyLength).toBe(NATURE_DRAGON_LENGTH);
    // A unicorn is a smaller animal than a dragon and must be told so, or the
    // separation rule silently treats every predator as the same size again.
    expect(unicorn?.bodyLength).toBeLessThan(NATURE_DRAGON_LENGTH);
  });

  it('keeps dragons from overlapping in a running simulation', () => {
    // The unit-level rule above can be right while the steering that consumes
    // it is not, so this asserts the behaviour end-to-end. On these two seeds
    // the flat 60-unit rule closed to 43.4 and 39.3 units — deep inside the
    // 67.5-unit wingspan — against 58.9 and 64.1 with size-aware separation.
    const closest = Math.min(
      closestDragonApproach({ seed: 3, seconds: 90 }),
      closestDragonApproach({ seed: 13, seconds: 90 }),
    );
    expect(closest).toBeGreaterThan(NATURE_DRAGON_WINGSPAN * 0.8);
  }, 60_000);
});
