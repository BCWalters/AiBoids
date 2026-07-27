import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Boid } from './Boid';
import { Predator, PredatorSpecies } from './Predator';
import { Simulation } from './Simulation';
import { params, resetParams } from './params';
import { create, distance } from './vector';

interface ChaseSetup {
  boidPosition: { x: number; y: number; z: number };
  boidVelocity: { x: number; y: number; z: number };
  predatorPosition: { x: number; y: number; z: number };
  predatorVelocity: { x: number; y: number; z: number };
}

function configureSinglePredatorChase(): void {
  resetParams();
  params.mode = '3d';
  params.boidCount = 1;
  params.multicolorCount = 0;
  params.goldCount = 0;
  params.redCount = 0;
  params.blueCount = 0;
  params.predatorCount = 1;
  params.monsterCount = 0;
  params.horseCount = 0;
}

function runChase(setup: ChaseSetup, seconds: number) {
  const sim = new Simulation(1000, 1000);
  const boid = new Boid({ ...setup.boidPosition }, { ...setup.boidVelocity });
  const predator = new Predator(
    { ...setup.predatorPosition },
    { ...setup.predatorVelocity },
    PredatorSpecies.Normal,
  );
  sim.boids = [boid];
  sim.predators = [predator];

  const dt = 1 / 60;
  let minDistance = distance(boid.position, predator.position);
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    sim.update(dt);
    minDistance = Math.min(minDistance, distance(boid.position, predator.position));
  }

  return {
    boid,
    predator,
    minDistance,
    finalDistance: distance(boid.position, predator.position),
  };
}

function wallDistance(position: { x: number; y: number; z: number }): number {
  return Math.min(
    position.x,
    position.y,
    position.z,
    1000 - position.x,
    1000 - position.y,
    1000 - position.z,
  );
}

function runOpenWaterDutyCycleScenario(seconds: number) {
  params.boidCount = 6;
  params.predatorCount = 3;
  params.monsterCount = 1;
  params.predatorCatchEnabled = false;

  const sim = new Simulation(1000, 1000);
  sim.boids = [
    new Boid(create(420, 480, 500), create(20, 10, 0)),
    new Boid(create(580, 520, 520), create(-15, 5, -10)),
    new Boid(create(520, 420, 450), create(10, 15, 10)),
    new Boid(create(480, 560, 550), create(-10, -10, 5)),
    new Boid(create(560, 460, 480), create(0, 20, -10)),
    new Boid(create(440, 540, 530), create(15, -5, 0)),
  ];
  sim.predators = [
    new Predator(create(140, 25, 500), create(45, 35, 0), PredatorSpecies.Normal),
    new Predator(create(860, 975, 500), create(-45, -35, 0), PredatorSpecies.Normal),
    new Predator(create(25, 500, 430), create(35, 10, 15), PredatorSpecies.Normal),
    new Predator(create(500, 520, 975), create(0, -15, -35), PredatorSpecies.Monster),
  ];

  const dt = 1 / 60;
  let overrideFrames = 0;
  let totalPredatorFrames = 0;
  let minBoidWallDistance = Infinity;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    sim.update(dt);
    for (const predator of sim.predators) {
      totalPredatorFrames++;
      if (predator.isBoundaryEscapeOverrideActive) overrideFrames++;
    }
    for (const boid of sim.boids) {
      minBoidWallDistance = Math.min(minBoidWallDistance, wallDistance(boid.position));
    }
  }

  return {
    overrideRatio: overrideFrames / totalPredatorFrames,
    minBoidWallDistance,
  };
}

describe('Simulation predator wall standoffs', () => {
  beforeEach(() => {
    configureSinglePredatorChase();
  });

  afterEach(() => {
    resetParams();
  });

  it('resolves a prey-vs-floor standoff instead of leaving both entities pinned in the boundary layer', () => {
    const { boid, predator, finalDistance } = runChase(
      {
        boidPosition: create(450, 120, 500),
        boidVelocity: create(40, 0, 0),
        predatorPosition: create(450, 220, 500),
        predatorVelocity: create(0, -120, 0),
      },
      20,
    );

    const resolved =
      boid.dying ||
      boid.position.y >= params.boundaryMargin ||
      predator.position.y >= params.boundaryMargin;

    expect(
      resolved,
      `boid y=${boid.position.y.toFixed(2)}, predator y=${predator.position.y.toFixed(2)}, dist=${finalDistance.toFixed(2)}`,
    ).toBe(true);
  });

  it('still closes distance in open water over the same number of steps', () => {
    const start = {
      boidPosition: create(450, 500, 500),
      boidVelocity: create(40, 0, 0),
      predatorPosition: create(450, 700, 500),
      predatorVelocity: create(0, -120, 0),
    };
    const initialDistance = distance(start.boidPosition, start.predatorPosition);
    const { finalDistance, minDistance } = runChase(start, 2);

    expect(finalDistance).toBeLessThan(initialDistance * 0.5);
    expect(minDistance).toBeLessThan(60);
  });

  it('keeps the escape override to a low duty cycle when predators skim a wall but prey stays in open water', () => {
    const { overrideRatio, minBoidWallDistance } = runOpenWaterDutyCycleScenario(6);

    expect(minBoidWallDistance).toBeGreaterThan(params.boundaryMargin * 2);
    expect(overrideRatio).toBeLessThan(0.01);
  });
});
