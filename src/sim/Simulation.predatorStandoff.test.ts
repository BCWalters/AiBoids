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
});
