import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Boid, BoidSpecies } from './Boid';
import { Predator, PredatorSpecies } from './Predator';
import { resetParams, params } from './params';
import { Simulation } from './Simulation';
import { create } from './vector';
import {
  ARCADE_PREDATOR_CATCH_PROFILES,
  FISHTANK_PREDATOR_CATCH_PROFILES,
  NATURE_PREDATOR_CATCH_PROFILES,
} from '../render/sceneRenderers/predatorCatchProfiles';
import { ARCADE_CREATURE_SIZES } from '../render/sceneRenderers/ArcadeSceneRenderer3D';
import { FISHTANK_CREATURE_SIZES } from '../render/sceneRenderers/FishtankSceneRenderer3D';
import { NATURE_CREATURE_SIZES } from '../render/sceneRenderers/NatureSceneRenderer3D';
import type { PredatorCatchProfile, PredatorCatchProfiles } from './predatorCatchProfiles';

function createManualSimulation(profiles: PredatorCatchProfiles): Simulation {
  resetParams();
  params.mode = '3d';
  params.running = true;
  params.boidCount = 0;
  params.multicolorCount = 0;
  params.goldCount = 0;
  params.redCount = 0;
  params.blueCount = 0;
  params.predatorCount = 0;
  params.monsterCount = 0;
  params.horseCount = 0;

  const sim = new Simulation(800, 600);
  sim.setPredatorCatchProfiles(profiles);
  sim.boids = [];
  sim.predators = [];
  return sim;
}

function runSingleCatchCheck(args: {
  species: PredatorSpecies;
  profile: PredatorCatchProfile;
  boidY: number;
}): { sim: Simulation; boid: Boid; predator: Predator } {
  const { species, profile, boidY } = args;
  const sim = createManualSimulation({ [species]: profile });
  const predator = new Predator(create(0, 0, 0), create(0, 40, 0), species);
  const boid = new Boid(create(0, boidY, 0), create(0, 0, 0), BoidSpecies.Normal);
  sim.predators.push(predator);
  sim.boids.push(boid);
  params.boidCount = 1;
  if (species === PredatorSpecies.Normal) params.predatorCount = 1;
  else if (species === PredatorSpecies.Monster) params.monsterCount = 1;
  else params.horseCount = 1;
  sim.update(0);
  return { sim, boid, predator };
}

describe('Simulation predator mouth catches', () => {
  beforeEach(() => {
    resetParams();
  });

  afterEach(() => {
    resetParams();
  });

  it('does not catch prey directly behind a shark even inside the old center sphere', () => {
    const shark = FISHTANK_PREDATOR_CATCH_PROFILES[PredatorSpecies.Monster]!;
    const { boid, predator, sim } = runSingleCatchCheck({
      species: PredatorSpecies.Monster,
      profile: shark,
      boidY: -17,
    });

    expect(boid.dying).toBe(false);
    expect(boid.deathTarget).toBeNull();
    expect(predator.digesting).toBe(false);
    expect(sim.catchEvents).toHaveLength(0);
  });

  it('catches prey placed at the shark mouth and pulls the death target to that mouth point', () => {
    const shark = FISHTANK_PREDATOR_CATCH_PROFILES[PredatorSpecies.Monster]!;
    const mouthY = shark.bodyLength * shark.mouthOffsetFraction;
    const { boid, predator, sim } = runSingleCatchCheck({
      species: PredatorSpecies.Monster,
      profile: shark,
      boidY: mouthY,
    });

    expect(boid.dying).toBe(true);
    expect(boid.deathTarget?.x).toBeCloseTo(0);
    expect(boid.deathTarget?.y).toBeCloseTo(mouthY);
    expect(boid.deathTarget?.z).toBeCloseTo(0);
    expect(predator.digesting).toBe(true);
    expect(sim.catchEvents).toHaveLength(1);
    expect(sim.catchEvents[0].direction).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('scales the effective catch reach with predator body length instead of using one shared distance', () => {
    const shark = FISHTANK_PREDATOR_CATCH_PROFILES[PredatorSpecies.Monster]!;
    const hawk = NATURE_PREDATOR_CATCH_PROFILES[PredatorSpecies.Normal]!;
    const sharedFrontDistance = 18;
    const sharkReach = shark.bodyLength * (shark.mouthOffsetFraction + shark.biteRadiusFraction);
    const hawkReach = hawk.bodyLength * (hawk.mouthOffsetFraction + hawk.biteRadiusFraction);

    expect(hawkReach).toBeLessThan(sharedFrontDistance);
    expect(sharkReach).toBeGreaterThan(sharedFrontDistance);
    expect(sharedFrontDistance).toBeLessThanOrEqual(18);

    const sharkResult = runSingleCatchCheck({
      species: PredatorSpecies.Monster,
      profile: shark,
      boidY: sharedFrontDistance,
    });
    const hawkResult = runSingleCatchCheck({
      species: PredatorSpecies.Normal,
      profile: hawk,
      boidY: sharedFrontDistance,
    });

    expect(sharkResult.boid.dying).toBe(true);
    expect(hawkResult.boid.dying).toBe(false);
  });

  it('keeps every scene bite radius at least as large as that scene’s largest prey half-length', () => {
    const cases = [
      {
        name: 'arcade',
        largestPreyHalfLength: Math.max(ARCADE_CREATURE_SIZES.boid.length, ARCADE_CREATURE_SIZES.parrot.length) / 2,
        profiles: ARCADE_PREDATOR_CATCH_PROFILES,
      },
      {
        name: 'fishtank',
        largestPreyHalfLength:
          Math.max(FISHTANK_CREATURE_SIZES.fish.length, FISHTANK_CREATURE_SIZES.butterflyfish.length) / 2,
        profiles: FISHTANK_PREDATOR_CATCH_PROFILES,
      },
      {
        name: 'nature',
        largestPreyHalfLength: Math.max(NATURE_CREATURE_SIZES.boid.length, NATURE_CREATURE_SIZES.parrot.length) / 2,
        profiles: NATURE_PREDATOR_CATCH_PROFILES,
      },
    ] as const;

    for (const { name, largestPreyHalfLength, profiles } of cases) {
      for (const [species, profile] of Object.entries(profiles)) {
        expect(
          profile!.bodyLength * profile!.biteRadiusFraction,
          `${name} ${species} bite radius must reach the largest prey half-length`,
        ).toBeGreaterThanOrEqual(largestPreyHalfLength);
      }
    }
  });
});
